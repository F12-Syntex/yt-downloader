#!/usr/bin/env node

import { select, input, checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default download directory
let downloadDir = path.join(process.cwd(), 'downloads');

// Temp directory for processing
const tempDir = path.join(os.tmpdir(), 'yt-downloader-temp');

// Cookies file path (set to your exported cookies.txt file)
let cookiesFile = 'C:\\Users\\synte\\Documents\\youtube_cookies.txt';

// ASCII Art Banner
const banner = `
${chalk.red('╔═══════════════════════════════════════════════════════════╗')}
${chalk.red('║')}  ${chalk.bold.white('🎬 Smart YouTube Downloader')}                              ${chalk.red('║')}
${chalk.red('║')}  ${chalk.gray('Download videos & playlists with ease')}                    ${chalk.red('║')}
${chalk.red('╚═══════════════════════════════════════════════════════════╝')}
`;

// Utility Functions
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanTempDir() {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  ensureDir(tempDir);
}

function sanitizeFilename(filename, asciiOnly = false) {
  let result = filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

  if (asciiOnly) {
    result = result.replace(/[^\x00-\x7F]/g, '');
  }

  return result
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
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

// Get playlist info using yt-dlp
async function getPlaylistInfo(url) {
  const spinner = ora('Fetching playlist information...').start();

  const args = ['--flat-playlist', '--dump-json'];
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push('--cookies', cookiesFile);
  }
  args.push(url);
  const attempts = [args];

  for (let i = 0; i < attempts.length; i++) {
    const args = attempts[i];

    try {
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { shell: true });
        let output = '';
        let errorOutput = '';

        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { errorOutput += data.toString(); });

        proc.on('close', (code) => {
          if (code === 0 && output) {
            try {
              const lines = output.trim().split('\n');
              const items = lines.map(line => JSON.parse(line));

              let playlistTitle = 'Playlist';
              let playlistAuthor = 'Unknown';
              let videos = [];

              for (const item of items) {
                if (item._type === 'playlist') {
                  playlistTitle = item.title || playlistTitle;
                  playlistAuthor = item.uploader || item.channel || playlistAuthor;
                } else if (item.id) {
                  videos.push({
                    title: item.title || 'Untitled',
                    url: `https://www.youtube.com/watch?v=${item.id}`,
                    duration: item.duration,
                    id: item.id
                  });
                }
              }

              if (videos.length > 0 && items[0]) {
                playlistTitle = items[0].playlist_title || items[0].playlist || playlistTitle;
              }

              resolve({ title: playlistTitle, author: playlistAuthor, items: videos });
            } catch (e) {
              reject(new Error('Failed to parse playlist info: ' + e.message));
            }
          } else {
            reject(new Error(errorOutput || 'Failed to fetch playlist info'));
          }
        });

        proc.on('error', reject);
      });

      spinner.succeed(`Playlist fetched: ${result.items.length} videos found!`);
      return result;
    } catch (err) {
      if (i < attempts.length - 1) {
        spinner.text = 'Retrying without cookies...';
        continue;
      }
      spinner.fail('Failed to fetch playlist information');
      throw err;
    }
  }
}

// Get video info using yt-dlp
async function getVideoInfo(url) {
  const spinner = ora('Fetching video information...').start();

  // Build args with cookies file
  const baseArgs = ['--dump-json', '--no-playlist'];
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    baseArgs.push('--cookies', cookiesFile);
  }
  const attempts = [
    [...baseArgs, url],
    [...baseArgs, '--extractor-args', 'youtube:player_client=tv', url]
  ];

  for (let i = 0; i < attempts.length; i++) {
    const args = attempts[i];

    try {
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { shell: true });
        let output = '';
        let errorOutput = '';

        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { errorOutput += data.toString(); });

        proc.on('close', (code) => {
          if (code === 0 && output) {
            try {
              const info = JSON.parse(output);
              resolve(info);
            } catch (e) {
              reject(new Error('Failed to parse video info'));
            }
          } else {
            reject(new Error(errorOutput || 'Failed to fetch video info'));
          }
        });

        proc.on('error', reject);
      });

      spinner.succeed('Video information fetched!');
      return result;
    } catch (err) {
      // If not last attempt, continue to next
      if (i < attempts.length - 1) {
        spinner.text = 'Retrying with different method...';
        continue;
      }
      spinner.fail('Failed to fetch video information');
      throw err;
    }
  }
}

// Download a single video with progress and status
async function downloadVideoWithProgress(url, options = {}) {
  const { format = 'both', quality = 'highest', outputDir = downloadDir, videoId = null } = options;

  // Create unique temp folder for this download
  const downloadTempDir = path.join(tempDir, videoId || Date.now().toString());
  ensureDir(downloadTempDir);
  ensureDir(outputDir);

  // Determine file extension based on format
  const ext = format === 'audio' ? 'mp3' : 'mp4';

  // Build yt-dlp arguments
  const outputTemplate = path.join(downloadTempDir, `%(title).100s.%(ext)s`);
  const args = [
    '--no-playlist',
    '-o', `"${outputTemplate}"`,
    '--restrict-filenames',
    '--newline',
    '--no-warnings',
    '--progress'
  ];

  // Add cookies file for authentication
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push('--cookies', cookiesFile);
  }

  // Format selection
  if (format === 'audio') {
    args.push('-x');
    args.push('--audio-format', 'mp3');
    args.push('--audio-quality', '0');
  } else if (format === 'video') {
    // Video only, no audio
    args.push('-f', 'bestvideo[ext=mp4]/bestvideo');
    args.push('--merge-output-format', 'mp4');
  } else {
    // Video + Audio
    if (quality === 'highest') {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    } else {
      args.push('-f', 'worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]/worst');
    }
    args.push('--merge-output-format', 'mp4');
  }

  args.push(url);

  // Progress bar
  const progressBar = new cliProgress.SingleBar({
    format: `   ${chalk.cyan('{bar}')} | {percentage}% | {speed} | {status}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
  });

  let progressStarted = false;
  let errorOutput = '';
  let currentStatus = 'Starting...';

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { shell: true });

    const updateProgress = (line) => {
      // Detect current phase
      if (line.includes('Downloading') && line.includes('video')) {
        currentStatus = 'Downloading video...';
      } else if (line.includes('Downloading') && line.includes('audio')) {
        currentStatus = 'Downloading audio...';
      } else if (line.includes('Merging')) {
        currentStatus = 'Merging files...';
      } else if (line.includes('Extracting audio') || line.includes('Converting')) {
        currentStatus = 'Converting to MP3...';
      } else if (line.includes('Deleting original')) {
        currentStatus = 'Cleaning up...';
      }

      // Parse progress percentage
      const progressMatch = line.match(/(\d+\.?\d*)%/);
      const speedMatch = line.match(/(\d+\.?\d*\s*[KMG]?i?B\/s)/i);

      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        const speed = speedMatch ? speedMatch[1] : 'N/A';

        if (!progressStarted) {
          progressBar.start(100, 0, { speed: 'Starting...', status: currentStatus });
          progressStarted = true;
        }
        progressBar.update(percent, { speed, status: currentStatus });
      }
    };

    proc.stdout.on('data', (data) => updateProgress(data.toString()));
    proc.stderr.on('data', (data) => {
      const line = data.toString();
      errorOutput += line;
      updateProgress(line);
    });

    proc.on('close', async (code) => {
      if (progressStarted) {
        progressBar.update(100, { speed: 'Done', status: 'Complete!' });
        progressBar.stop();
      }

      if (code === 0) {
        // Move files from temp to output directory
        try {
          const files = fs.readdirSync(downloadTempDir);
          const targetFiles = files.filter(f => f.endsWith(`.${ext}`));

          if (targetFiles.length > 0) {
            for (const file of targetFiles) {
              const src = path.join(downloadTempDir, file);
              const dest = path.join(outputDir, file);

              // Small delay to ensure file handles are released
              await new Promise(r => setTimeout(r, 100));

              fs.copyFileSync(src, dest);
            }
            console.log(chalk.green(`   ✅ Saved to: ${outputDir}`));
          }

          // Cleanup temp folder
          fs.rmSync(downloadTempDir, { recursive: true, force: true });

          resolve(outputDir);
        } catch (moveErr) {
          console.log(chalk.yellow(`   ⚠ Download complete but file move failed: ${moveErr.message}`));
          console.log(chalk.gray(`   Files are in: ${downloadTempDir}`));
          resolve(downloadTempDir);
        }
      } else {
        // Cleanup on failure
        fs.rmSync(downloadTempDir, { recursive: true, force: true });

        const errorMatch = errorOutput.match(/ERROR:\s*(.+)/i);
        const errorMsg = errorMatch ? errorMatch[1].trim() : `Download failed with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    proc.on('error', (err) => {
      if (progressStarted) progressBar.stop();
      fs.rmSync(downloadTempDir, { recursive: true, force: true });
      reject(err);
    });
  });
}

// Download single video (standalone)
async function downloadVideo(url, options = {}) {
  const { format = 'both', quality = 'highest' } = options;

  try {
    const info = await getVideoInfo(url);
    const videoTitle = info.title || 'Untitled Video';

    console.log(chalk.cyan('\n📹 Video Details:'));
    console.log(chalk.white(`   Title: ${videoTitle}`));
    console.log(chalk.white(`   Channel: ${info.uploader || info.channel || 'Unknown'}`));
    console.log(chalk.white(`   Duration: ${formatDuration(info.duration || 0)}`));
    console.log(chalk.white(`   Views: ${(info.view_count || 0).toLocaleString()}`));

    console.log(chalk.green(`\n⬇️  Downloading...\n`));

    await downloadVideoWithProgress(url, {
      format,
      quality,
      outputDir: downloadDir,
      videoId: info.id
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
      console.log(chalk.white(`   ${(index + 1).toString().padStart(3)}. ${title.substring(0, 55)}${title.length > 55 ? '...' : ''} [${duration}]`));
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
          name: `${(index + 1).toString().padStart(3)}. ${title.substring(0, 45)} [${formatDuration(item.duration)}]`,
          value: item,
          checked: false
        };
      });

      selectedVideos = await checkbox({
        message: 'Select videos (space to select, enter to confirm):',
        choices: choices,
        pageSize: 15
      });
    } else if (selectOption === 'range') {
      const rangeInput = await input({
        message: 'Enter range (e.g., 1-10 or 1,3,5,7):',
        validate: (value) => value ? true : 'Please enter a range'
      });

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

    // Create playlist folder with clean name
    const playlistFolderName = sanitizeFilename(playlist.title, true);
    const playlistFolder = path.join(downloadDir, playlistFolderName);
    ensureDir(playlistFolder);

    const ext = format === 'audio' ? 'mp3' : 'mp4';
    console.log(chalk.green(`\n🚀 Downloading ${selectedVideos.length} ${ext.toUpperCase()} files to: ${playlistFolderName}/\n`));

    let successful = 0;
    let failed = 0;

    for (let i = 0; i < selectedVideos.length; i++) {
      const video = selectedVideos[i];
      const title = (video.title || 'Untitled').substring(0, 50);
      console.log(chalk.cyan(`\n[${i + 1}/${selectedVideos.length}] ${title}${video.title?.length > 50 ? '...' : ''}`));

      try {
        await downloadVideoWithProgress(video.url, {
          format,
          quality,
          outputDir: playlistFolder,
          videoId: video.id
        });
        successful++;
      } catch (error) {
        console.log(chalk.red(`   ❌ Failed: ${error.message}`));
        failed++;
      }
    }

    console.log(chalk.green(`\n${'═'.repeat(50)}`));
    console.log(chalk.green(`✨ Playlist download complete!`));
    console.log(chalk.white(`   ✅ Successful: ${successful}`));
    if (failed > 0) {
      console.log(chalk.red(`   ❌ Failed: ${failed}`));
    }
    console.log(chalk.white(`   📁 Location: ${playlistFolder}`));
    console.log(chalk.green(`${'═'.repeat(50)}`));

  } catch (error) {
    console.log(chalk.red(`\n❌ Error: ${error.message}`));
  }
}

// Format selection menu
async function selectFormat() {
  return await select({
    message: 'Select download format:',
    choices: [
      { name: '🎵 Audio only (MP3)', value: 'audio' },
      { name: '🎬 Video + Audio (MP4)', value: 'both' },
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
    console.log(chalk.white(`   Cookies File: ${cookiesFile || 'none'}`));

    const choice = await select({
      message: 'Settings:',
      choices: [
        { name: '📁 Change download directory', value: 'directory' },
        { name: '🍪 Change cookies file', value: 'cookies' },
        { name: '🔄 Update yt-dlp', value: 'update' },
        { name: '🧹 Clear temp files', value: 'clear' },
        { name: '🔙 Back to main menu', value: 'back' }
      ]
    });

    if (choice === 'back') {
      break;
    } else if (choice === 'directory') {
      const newDir = await input({
        message: 'Enter new download directory:',
        default: downloadDir,
        validate: (value) => value ? true : 'Directory path cannot be empty'
      });
      downloadDir = path.resolve(newDir);
      console.log(chalk.green(`✅ Download directory updated to: ${downloadDir}`));
    } else if (choice === 'cookies') {
      const newPath = await input({
        message: 'Enter path to cookies.txt file (or empty to disable):',
        default: cookiesFile || ''
      });
      cookiesFile = newPath || null;
      if (cookiesFile && fs.existsSync(cookiesFile)) {
        console.log(chalk.green(`✅ Cookies file set to: ${cookiesFile}`));
      } else if (cookiesFile) {
        console.log(chalk.yellow(`⚠ File not found: ${cookiesFile}`));
      } else {
        console.log(chalk.green(`✅ Cookies disabled`));
      }
    } else if (choice === 'update') {
      const spinner = ora('Updating yt-dlp...').start();
      try {
        execSync('yt-dlp -U', { stdio: 'pipe' });
        spinner.succeed('yt-dlp updated successfully!');
      } catch (error) {
        spinner.fail('Failed to update. Try: pip install -U yt-dlp');
      }
    } else if (choice === 'clear') {
      cleanTempDir();
      console.log(chalk.green('✅ Temp files cleared!'));
    }
  }
}

// Main menu
async function mainMenu() {
  console.clear();
  console.log(banner);

  // Check dependencies
  const hasYtDlp = await checkYtDlp();
  if (!hasYtDlp) {
    console.log(chalk.red('❌ yt-dlp is not installed!'));
    console.log(chalk.yellow('\nInstall with one of:'));
    console.log(chalk.white('  winget install yt-dlp'));
    console.log(chalk.white('  pip install yt-dlp'));
    console.log(chalk.white('  choco install yt-dlp\n'));
    process.exit(1);
  }

  console.log(chalk.green('✓ yt-dlp found'));

  const hasFfmpeg = checkFfmpeg();
  if (hasFfmpeg) {
    console.log(chalk.green('✓ ffmpeg found'));
  } else {
    console.log(chalk.yellow('⚠ ffmpeg not found - MP3 conversion won\'t work'));
    console.log(chalk.gray('  Install: winget install ffmpeg'));
  }

  if (cookiesFile && fs.existsSync(cookiesFile)) {
    console.log(chalk.green(`✓ Using cookies from: ${cookiesFile}\n`));
  } else {
    console.log(chalk.yellow(`⚠ No cookies file found\n`));
  }

  // Clean temp on start
  cleanTempDir();

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
      cleanTempDir();
      console.log(chalk.cyan('\n👋 Goodbye!\n'));
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
      console.log(chalk.cyan(`🔍 Detected: ${isPlaylist ? 'Playlist' : 'Single Video'}`));
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
      message: '\nDownload more?',
      default: true
    });

    if (!continueChoice) {
      cleanTempDir();
      console.log(chalk.cyan('\n👋 Goodbye!\n'));
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

  const url = args[0];
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    console.log(chalk.red('Invalid YouTube URL'));
    process.exit(1);
  }

  const isPlaylist = url.includes('list=');
  const format = args.includes('--audio') ? 'audio' : args.includes('--video-only') ? 'video' : 'both';

  cleanTempDir();

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

  cleanTempDir();
}

// Start
handleArgs().catch(console.error);
