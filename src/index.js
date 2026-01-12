#!/usr/bin/env node

import { select, input, checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';
import ytdl from '@distube/ytdl-core';
import ytpl from '@distube/ytpl';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
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

// Check if ffmpeg is available
async function checkFfmpeg() {
  return new Promise((resolve) => {
    const process = spawn('ffmpeg', ['-version'], { shell: true });
    process.on('close', (code) => resolve(code === 0));
    process.on('error', () => resolve(false));
  });
}

// Get video info
async function getVideoInfo(url) {
  const spinner = ora('Fetching video information...').start();
  try {
    const info = await ytdl.getInfo(url);
    spinner.succeed('Video information fetched!');
    return info;
  } catch (error) {
    spinner.fail('Failed to fetch video information');
    throw error;
  }
}

// Get playlist info
async function getPlaylistInfo(url) {
  const spinner = ora('Fetching playlist information...').start();
  try {
    const playlist = await ytpl(url, { limit: Infinity });
    spinner.succeed(`Playlist fetched: ${playlist.items.length} videos found!`);
    return playlist;
  } catch (error) {
    spinner.fail('Failed to fetch playlist information');
    throw error;
  }
}

// Get available formats
function getAvailableFormats(info, type) {
  const formats = info.formats;

  if (type === 'audio') {
    return formats
      .filter(f => f.hasAudio && !f.hasVideo)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
  } else if (type === 'video') {
    return formats
      .filter(f => f.hasVideo)
      .sort((a, b) => {
        const aHeight = parseInt(a.height) || 0;
        const bHeight = parseInt(b.height) || 0;
        return bHeight - aHeight;
      });
  } else {
    // Both audio and video
    return formats
      .filter(f => f.hasVideo && f.hasAudio)
      .sort((a, b) => {
        const aHeight = parseInt(a.height) || 0;
        const bHeight = parseInt(b.height) || 0;
        return bHeight - aHeight;
      });
  }
}

// Download single video
async function downloadVideo(url, options = {}) {
  const { format = 'both', quality = 'highest', outputPath = downloadDir } = options;

  ensureDownloadDir();

  try {
    const info = await getVideoInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);

    console.log(chalk.cyan('\n📹 Video Details:'));
    console.log(chalk.white(`   Title: ${info.videoDetails.title}`));
    console.log(chalk.white(`   Channel: ${info.videoDetails.author.name}`));
    console.log(chalk.white(`   Duration: ${formatDuration(parseInt(info.videoDetails.lengthSeconds))}`));
    console.log(chalk.white(`   Views: ${parseInt(info.videoDetails.viewCount).toLocaleString()}`));

    let selectedFormat;
    const availableFormats = getAvailableFormats(info, format);

    if (availableFormats.length === 0) {
      console.log(chalk.yellow('\nNo formats available for selected type. Using best available...'));
      selectedFormat = ytdl.chooseFormat(info.formats, { quality: 'highest' });
    } else if (quality === 'select') {
      // Let user select quality
      const formatChoices = availableFormats.slice(0, 10).map(f => ({
        name: `${f.qualityLabel || f.audioQuality || 'Unknown'} - ${f.container} ${f.hasVideo ? '(video)' : ''} ${f.hasAudio ? '(audio)' : ''} - ${formatBytes(f.contentLength)}`,
        value: f
      }));

      selectedFormat = await select({
        message: 'Select quality:',
        choices: formatChoices
      });
    } else {
      selectedFormat = availableFormats[0];
    }

    const extension = format === 'audio' ? 'mp3' : selectedFormat.container || 'mp4';
    const filename = `${title}.${extension}`;
    const filepath = path.join(outputPath, filename);

    console.log(chalk.green(`\n⬇️  Downloading: ${filename}`));

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: chalk.cyan('{bar}') + ' | {percentage}% | {downloaded}/{total}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true
    });

    return new Promise((resolve, reject) => {
      const stream = ytdl(url, { format: selectedFormat });
      const writeStream = fs.createWriteStream(filepath);

      let totalSize = parseInt(selectedFormat.contentLength) || 0;
      let downloaded = 0;
      let started = false;

      stream.on('response', (res) => {
        totalSize = parseInt(res.headers['content-length']) || totalSize;
        if (totalSize > 0) {
          progressBar.start(totalSize, 0, {
            downloaded: formatBytes(0),
            total: formatBytes(totalSize)
          });
          started = true;
        }
      });

      stream.on('data', (chunk) => {
        downloaded += chunk.length;
        if (started) {
          progressBar.update(downloaded, {
            downloaded: formatBytes(downloaded),
            total: formatBytes(totalSize)
          });
        }
      });

      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        if (started) progressBar.stop();
        console.log(chalk.green(`\n✅ Downloaded successfully: ${filepath}`));
        resolve(filepath);
      });

      stream.on('error', (err) => {
        if (started) progressBar.stop();
        reject(err);
      });

      writeStream.on('error', (err) => {
        if (started) progressBar.stop();
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
    console.log(chalk.white(`   Channel: ${playlist.author?.name || 'Unknown'}`));
    console.log(chalk.white(`   Total Videos: ${playlist.items.length}`));

    // Show all videos
    console.log(chalk.yellow('\n📹 Videos in playlist:\n'));
    playlist.items.forEach((item, index) => {
      const duration = formatDuration(item.durationSec);
      console.log(chalk.white(`   ${(index + 1).toString().padStart(3)}. ${item.title.substring(0, 60)}${item.title.length > 60 ? '...' : ''} [${duration}]`));
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
      const choices = playlist.items.map((item, index) => ({
        name: `${(index + 1).toString().padStart(3)}. ${item.title.substring(0, 50)} [${formatDuration(item.durationSec)}]`,
        value: item,
        checked: false
      }));

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

    // Create playlist folder
    const playlistFolder = path.join(downloadDir, sanitizeFilename(playlist.title));
    if (!fs.existsSync(playlistFolder)) {
      fs.mkdirSync(playlistFolder, { recursive: true });
    }

    console.log(chalk.green(`\n🚀 Starting download of ${selectedVideos.length} videos...\n`));

    let successful = 0;
    let failed = 0;

    for (let i = 0; i < selectedVideos.length; i++) {
      const video = selectedVideos[i];
      console.log(chalk.cyan(`\n[${i + 1}/${selectedVideos.length}] ${video.title}`));

      try {
        await downloadVideo(video.url, {
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
      { name: '📊 Let me choose', value: 'select' },
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
    }
  }
}

// Main menu
async function mainMenu() {
  console.clear();
  console.log(banner);

  // Check ffmpeg
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.log(chalk.yellow('⚠️  FFmpeg not found. Some features may be limited.\n'));
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
handleArgs().catch(co