#!/usr/bin/env node

import { select, input, checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default download directory
let downloadDir = path.join(process.cwd(), 'downloads');

// ASCII Art Banner
const banner = `
${chalk.red('╔═══════════════════════════════════════════════════════════╗')}
${chalk.red('║')}  ${chalk.bold.white('🎬 Smart YouTube Downloader')}                              ${chalk.red('║')}
${chalk.red('║')}  ${chalk.gray('Download videos & playlists with ease')}                    ${chalk.red('║')}
${chalk.red('╚═══════════════════════════════════════════════════════════╝')}
`;

// Utility Functions
function ensureDownloadDir() {
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
}

function sanitizeFilename(filename, asciiOnly = false) {
  let result = filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ''); // Remove control characters

  if (asciiOnly) {
    // Remove non-ASCII characters for safer folder names
    result = result.replace(/[^\x00-\x7F]/g, '');
  }

  return result
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .trim()
    .substring(0, 150) || 'download';
}

function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Check if yt-dlp is available
async function checkYtDlp() {
  return new Promise((resolve) => {
    try {
      execSync('yt-dlp --version', { stdio: 'pipe' });
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

// Check if ffmpeg is available
function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Get video info using yt-dlp
async function getVideoInfo(url) {
  const spinner = ora('Fetching video information...').start();
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      url
    ];

    const process = spawn('yt-dlp', args, { shell: true });
    let output = '';
    let errorOutput = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0 && output) {
        try {
          const info = JSON.parse(output);
          spinner.succeed('Video information fetched!');
          resolve(info);
        } catch (e) {
          spinner.fail('Failed to parse video information');
          reject(new Error('Failed to parse video info'));
        }
      } else {
        spinner.fail('Failed to fetch video information');
        reject(new Error(errorOutput || 'Failed to fetch video info'));
      }
    });

    process.on('error', (err) => {
      spinner.fail('Failed to run yt-dlp');
      reject(err);
    });
  });
}

// Get playlist info using yt-dlp
async function getPlaylistInfo(url) {
  const spinner = ora('Fetching playlist information...').start();
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist',
      '--dump-json',
      url
    ];

    const process = spawn('yt-dlp', args, { shell: true });
    let output = '';
    let errorOutput = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0 && output) {
        try {
          const lines = output.trim().split('\n');
          const items = lines.map(line => JSON.parse(line));

          // First item might be playlist metadata
          let playlistTitle = 'Playlist';
          let playlistAuthor = 'Unknown';
          let videos = [];

          for (const item of items) {
            if (item._type === 'playlist') {
              playlistTitle = item.title || playlistTitle;
              playlistAuthor = item.uploader || item.channel || playlistAuthor;
            } else if (item.id) {
              // Always construct full YouTube URL from video ID
              videos.push({
                title: item.title || 'Untitled',
                url: `https://www.youtube.com/watch?v=${item.id}`,
                duration: item.duration,
                id: item.id
              });
            }
          }

          // If no playlist metadata found, try to extract from first video's playlist info
          if (videos.length > 0 && items[0]) {
            playlistTitle = items[0].playlist_title || items[0].playlist || playlistTitle;
          }

          spinner.succeed(`Playlist fetched: ${videos.length} videos found!`);
          resolve({
            title: playlistTitle,
            author: playlistAuthor,
            items: videos
          });
        } catch (e) {
          spinner.fail('Failed to parse playlist information');
          reject(new Error('Failed to parse playlist info: ' + e.message));
        }
      } else {
        spinner.fail('Failed to fetch playlist information');
        reject(new Error(errorOutput || 'Failed to fetch playlist info'));
      }
    });

    process.on('error', (err) => {
      spinner.fail('Failed to run yt-dlp');
      reject(err);
    });
  });
}

// Download single video using yt-dlp
async function downloadVideo(url, options = {}) {
  const { format = 'both', quality = 'highest', outputPath = downloadDir } = options;

  ensureDownloadDir();
  const targetDir = outputPath || downloadDir;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  try {
    // First get video info
    const info = await getVideoInfo(url);
    const videoTitle = info.title || 'Untitled Video';

    console.log(chalk.cyan('\n📹 Video Details:'));
    console.log(chalk.white(`   Title: ${videoTitle}`));
    console.log(chalk.white(`   Channel: ${info.uploader || info.channel || 'Unknown'}`));
    console.log(chalk.white(`   Duration: ${formatDuration(info.duration || 0)}`));
    console.log(chalk.white(`   Views: ${(info.view_count || 0).toLocaleString()}`));

    // Build yt-dlp arguments - use restricted filenames for Windows compatibility
    const outputTemplate = path.join(targetDir, '%(title).150s.%(ext)s');
    const args = [
      '--no-playlist',
      '-o', `"${outputTemplate}"`,
      '--restrict-filenames',
      '--progress',
      '--newline'
    ];

    // Format selection
    if (format === 'audio') {
      args.push('-x');  // Extract audio
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', '0');  // Best quality
    } else if (format === 'video') {
      args.push('-f', 'bestvideo[ext=mp4]/bestvideo');
    } else {
      // Both audio and video
      if (quality === 'highest') {
        args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      } else if (quality === 'lowest') {
        args.push('-f', 'worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]/worst');
      } else {
        args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      }
    }

    args.push(url);

    console.log(chalk.green(`\n⬇️  Downloading: ${videoTitle}`));

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: chalk.cyan('{bar}') + ' | {percentage}% | {speed}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true
    });

    let progressStarted = false;

    return new Promise((resolve, reject) => {
      const process = spawn('yt-dlp', args, { shell: true });

      process.stdout.on('data', (data) => {
        const line = data.toString();

        // Parse progress from yt-dlp output
        const progressMatch = line.match(/(\d+\.?\d*)%/);
        const speedMatch = line.match(/at\s+([^\s]+)/);

        if (progressMatch) {
          const percent = parseFloat(progressMatch[1]);
          const speed = speedMatch ? speedMatch[1] : 'N/A';

          if (!progressStarted) {
            progressBar.start(100, 0, { speed: 'Starting...' });
            progressStarted = true;
          }
          progressBar.update(percent, { speed: speed });
        }
      });

      process.stderr.on('data', (data) => {
        // yt-dlp outputs progress to stderr sometimes
        const line = data.toString();
        const progressMatch = line.match(/(\d+\.?\d*)%/);
        const speedMatch = line.match(/at\s+([^\s]+)/);

        if (progressMatch) {
          const percent = parseFloat(progressMatch[1]);
          const speed = speedMatch ? speedMatch[1] : 'N/A';

          if (!progressStarted) {
            progressBar.start(100, 0, { speed: 'Starting...' });
            progressStarted = true;
          }
          progressBar.update(percent, { speed: speed });
        }
      });

      process.on('close', (code) => {
        if (progressStarted) progressBar.stop();

        if (code === 0) {
          console.log(chalk.green(`✅ Downloaded successfully to: ${targetDir}`));
          resolve(targetDir);
        } else {
          reject(new Error(`Download failed with code ${code}`));
        }
      });

      process.on('error', (err) => {
        if (progressStarted) progressBar.stop();
        reject(err);
      });
    });
  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}`));
    throw error;
  }
}

// Download playlist
async function downloadPlaylist(url, options = {}) {
  const { format = 'both', quality = 'highest' } = options;

  try {
    const playlist = await getPlaylistInfo(url);

    console.log(chalk.cyan('\n📋 Playlist Details:'));
    console.log(chalk.white(`   Title: ${playlist.title}`));
    console.log(chalk.white(`   Channel: ${playlist.author}`));
    console.log(chalk.white(`   Total Videos: ${playlist.items.length}`));

    // Show all videos
    console.log(chalk.yellow('\n📹 Videos in playlist:\n'));
    playlist.items.forEach((item, index) => {
      const duration = formatDuration(item.duration);
      const title = item.title || 'Untitled';
      console.log(chalk.white(`   ${(index + 1).toString().padStart(3)}. ${title.substring(0, 60)}${title.length > 60 ? '...' : ''} [${duration}]`));
    });

    // Let user select videos
    const selectOption = await select({
      message: '\nWhat would you like to download?',
      choices: [
        { name: 'Download all videos', value: 'all' },
        { name: 'Select specific videos', value: 'select' },
        { name: 'Download range (e.g., 1-10)', value: 'range' },
        { name: 'Cancel', value: 'cancel' }
      ]
    });

    let selectedVideos = [];

    if (selectOption === 'cancel') {
      return;
    } else if (selectOption === 'all') {
      selectedVideos = playlist.items;
    } else if (selectOption === 'select') {
      const choices = playlist.items.map((item, index) => {
        const title = item.title || 'Untitled';
        return {
          name: `${(index + 1).toString().padStart(3)}. ${title.substring(0, 50)} [${formatDuration(item.duration)}]`,
          value: item,
          checked: false
        };
      });

      selectedVideos = await checkbox({
        message: 'Select videos to download (space to select, enter to confirm):',
        choices: choices,
        pageSize: 15
      });
    } else if (selectOption === 'range') {
      const rangeInput = await input({
        message: 'Enter range (e.g., 1-10 or 1,3,5,7):',
        validate: (value) => {
          if (!value) return 'Please enter a range';
          return true;
        }
      });

      // Parse range
      if (rangeInput.includes('-')) {
        const [start, end] = rangeInput.split('-').map(n => parseInt(n.trim()));
        selectedVideos = playlist.items.slice(start - 1, end);
      } else {
        const indices = rangeInput.split(',').map(n => parseInt(n.trim()) - 1);
        selectedVideos = indices.map(i => playlist.items[i]).filter(Boolean);
      }
    }

    if (selectedVideos.length === 0) {
      console.log(chalk.yellow('No videos selected.'));
      return;
    }

    const confirmDownload = await confirm({
      message: `Download ${selectedVideos.length} video(s)?`,
      default: true
    });

    if (!confirmDownload) {
      return;
    }

    // Create playlist folder with ASCII-safe name
    const playlistFolder = path.join(downloadDir, sanitizeFilename(playlist.title, true));
    if (!fs.existsSync(playlistFolder)) {
      fs.mkdirSync(playlistFolder, { recursive: true });
    }

    console.log(chalk.green(`\n🚀 Starting download of ${selectedVideos.length} videos...\n`));

    let successful = 0;
    let failed = 0;

    for (let i = 0; i < selectedVideos.length; i++) {
      const video = selectedVideos[i];
      console.log(chalk.cyan(`\n[${i + 1}/${selectedVideos.length}] ${video.title || 'Untitled'}`));

      try {
        await downloadVideoSimple(video.url, {
          format,
          quality,
          outputPath: playlistFolder
        });
        successful++;
      } catch (error) {
        console.log(chalk.red(`   Failed: ${error.message}`));
        failed++;
      }
    }

    console.log(chalk.green(`\n✨ Playlist download complete!`));
    console.log(chalk.white(`   Successful: ${successful}`));
    if (failed > 0) {
      console.log(chalk.red(`   Failed: ${failed}`));
    }
    console.log(chalk.white(`   Location: ${playlistFolder}`));

  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}`));
  }
}

// Simple download without fetching info first (for playlist items)
async function downloadVideoSimple(url, options = {}) {
  const { format = 'both', quality = 'highest', outputPath = downloadDir } = options;

  const targetDir = outputPath || downloadDir;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Build yt-dlp arguments - use restricted filenames for Windows compatibility
  const outputTemplate = path.join(targetDir, '%(title).150s.%(ext)s');
  const args = [
    '--no-playlist',
    '-o', `"${outputTemplate}"`,
    '--restrict-filenames',
    '--progress',
    '--newline',
    '--no-warnings'
  ];

  // Format selection
  if (format === 'audio') {
    args.push('-x');
    args.push('--audio-format', 'mp3');
    args.push('--audio-quality', '0');
  } else if (format === 'video') {
    args.push('-f', 'bestvideo[ext=mp4]/bestvideo');
  } else {
    if (quality === 'highest') {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    } else if (quality === 'lowest') {
      args.push('-f', 'worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]/worst');
    } else {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    }
  }

  args.push(url);

  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: chalk.cyan('{bar}') + ' | {percentage}% | {speed}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
  });

  let progressStarted = false;
  let errorOutput = '';

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { shell: true });

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      const progressMatch = line.match(/(\d+\.?\d*)%/);
      const speedMatch = line.match(/at\s+([^\s]+)/);

      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        const speed = speedMatch ? speedMatch[1] : 'N/A';

        if (!progressStarted) {
          progressBar.start(100, 0, { speed: 'Starting...' });
          progressStarted = true;
        }
        progressBar.update(percent, { speed: speed });
      }
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      errorOutput += line;

      const progressMatch = line.match(/(\d+\.?\d*)%/);
      const speedMatch = line.match(/at\s+([^\s]+)/);

      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        const speed = speedMatch ? speedMatch[1] : 'N/A';

        if (!progressStarted) {
          progressBar.start(100, 0, { speed: 'Starting...' });
          progressStarted = true;
        }
        progressBar.update(percent, { speed: speed });
      }
    });

    proc.on('close', (code) => {
      if (progressStarted) progressBar.stop();

      if (code === 0) {
        console.log(chalk.green(`   ✅ Downloaded successfully!`));
        resolve(targetDir);
      } else {
        // Extract meaningful error from output
        const errorMatch = errorOutput.match(/ERROR:\s*(.+)/i);
        const errorMsg = errorMatch ? errorMatch[1].trim() : `Download failed with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    proc.on('error', (err) => {
      if (progressStarted) progressBar.stop();
      reject(err);
    });
  });
}

// Format selection menu
async function selectFormat() {
  return await select({
    message: 'Select download format:',
    choices: [
      { name: '🎬 Video + Audio (best quality)', value: 'both' },
      { name: '🎵 Audio only (MP3)', value: 'audio' },
      { name: '📹 Video only (no audio)', value: 'video' }
    ]
  });
}

// Quality selection menu
async function selectQuality() {
  return await select({
    message: 'Select quality preference:',
    choices: [
      { name: '⭐ Highest available', value: 'highest' },
      { name: '💾 Lowest (save space)', value: 'lowest' }
    ]
  });
}

// Settings menu
async function settingsMenu() {
  while (true) {
    console.log(chalk.cyan('\n⚙️  Current Settings:'));
    console.log(chalk.white(`   Download Directory: ${downloadDir}`));

    const choice = await select({
      message: 'Settings:',
      choices: [
        { name: '📁 Change download directory', value: 'directory' },
        { name: '🔄 Update yt-dlp', value: 'update' },
        { name: '🔙 Back to main menu', value: 'back' }
      ]
    });

    if (choice === 'back') {
      break;
    } else if (choice === 'directory') {
      const newDir = await input({
        message: 'Enter new download directory:',
        default: downloadDir,
        validate: (value) => {
          if (!value) return 'Directory path cannot be empty';
          return true;
        }
      });
      downloadDir = path.resolve(newDir);
      console.log(chalk.green(`✅ Download directory updated to: ${downloadDir}`));
    } else if (choice === 'update') {
      const spinner = ora('Updating yt-dlp...').start();
      try {
        execSync('yt-dlp -U', { stdio: 'pipe' });
        spinner.succeed('yt-dlp updated successfully!');
      } catch (error) {
        spinner.fail('Failed to update yt-dlp. Try running: pip install -U yt-dlp');
      }
    }
  }
}

// Main menu
async function mainMenu() {
  console.clear();
  console.log(banner);

  // Check yt-dlp
  const hasYtDlp = await checkYtDlp();
  if (!hasYtDlp) {
    console.log(chalk.red('❌ yt-dlp is not installed!'));
    console.log(chalk.yellow('\nPlease install yt-dlp first:'));
    console.log(chalk.white('  Windows: winget install yt-dlp'));
    console.log(chalk.white('  Or: pip install yt-dlp'));
    console.log(chalk.white('  Or: choco install yt-dlp'));
    console.log(chalk.white('\nMac: brew install yt-dlp'));
    console.log(chalk.white('Linux: pip install yt-dlp\n'));
    process.exit(1);
  }

  console.log(chalk.green('✓ yt-dlp found'));

  const hasFfmpeg = checkFfmpeg();
  if (hasFfmpeg) {
    console.log(chalk.green('✓ ffmpeg found\n'));
  } else {
    console.log(chalk.yellow('⚠ ffmpeg not found - MP3 conversion may not work'));
    console.log(chalk.gray('  Install: winget install ffmpeg  |  choco install ffmpeg\n'));
  }

  while (true) {
    const choice = await select({
      message: 'What would you like to do?',
      choices: [
        { name: '📹 Download a single video', value: 'video' },
        { name: '📋 Download a playlist', value: 'playlist' },
        { name: '🔗 Paste URL (auto-detect)', value: 'auto' },
        { name: '⚙️  Settings', value: 'settings' },
        { name: '❌ Exit', value: 'exit' }
      ]
    });

    if (choice === 'exit') {
      console.log(chalk.cyan('\n👋 Goodbye! Happy downloading!\n'));
      process.exit(0);
    }

    if (choice === 'settings') {
      await settingsMenu();
      continue;
    }

    // Get URL
    let url;
    if (choice === 'video' || choice === 'playlist' || choice === 'auto') {
      url = await input({
        message: 'Enter YouTube URL:',
        validate: (value) => {
          if (!value) return 'Please enter a URL';
          if (!value.includes('youtube.com') && !value.includes('youtu.be')) {
            return 'Please enter a valid YouTube URL';
          }
          return true;
        }
      });
    }

    // Auto-detect type
    let isPlaylist = choice === 'playlist';
    if (choice === 'auto') {
      isPlaylist = url.includes('list=');
      if (isPlaylist) {
        console.log(chalk.cyan('🔍 Detected: Playlist'));
      } else {
        console.log(chalk.cyan('🔍 Detected: Single Video'));
      }
    }

    // Get format and quality
    const format = await selectFormat();
    const quality = await selectQuality();

    try {
      if (isPlaylist) {
        await downloadPlaylist(url, { format, quality });
      } else {
        await downloadVideo(url, { format, quality });
      }
    } catch (error) {
      console.log(chalk.red(`\n❌ Download failed: ${error.message}`));
    }

    // Ask to continue
    const continueChoice = await confirm({
      message: '\nWould you like to download more?',
      default: true
    });

    if (!continueChoice) {
      console.log(chalk.cyan('\n👋 Goodbye! Happy downloading!\n'));
      process.exit(0);
    }

    console.clear();
    console.log(banner);
  }
}

// Handle command line arguments
async function handleArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return mainMenu();
  }

  // Quick download mode
  const url = args[0];
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    console.log(chalk.red('Invalid YouTube URL'));
    process.exit(1);
  }

  const isPlaylist = url.includes('list=');
  const format = args.includes('--audio') ? 'audio' : args.includes('--video-only') ? 'video' : 'both';

  try {
    if (isPlaylist) {
      await downloadPlaylist(url, { format, quality: 'highest' });
    } else {
      await downloadVideo(url, { format, quality: 'highest' });
    }
  } catch (error) {
    console.log(chalk.red(`Download failed: ${error.message}`));
    process.exit(1);
  }
}

// Start the application
handleArgs().catch(console.error);
