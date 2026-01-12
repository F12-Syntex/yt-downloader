const UTIL = require('./util.js');

const BASE_VIDEO_URL = 'https://www.youtube.com/watch?v=';

module.exports = (item) => {
  const type = Object.keys(item)[0];
  if (type !== 'playlistVideoRenderer') return null;

  const info = item.playlistVideoRenderer;
  if (!info || !info.shortBylineText || info.upcomingEventData || !info.isPlayable) return null;
  const isLive = info.thumbnailOverlays.some(
    (a) => a.thumbnailOverlayTimeStatusRenderer && a.thumbnailOverlayTimeStatusRenderer.style === 'LIVE'
  );
  const author = info.shortBylineText.runs[0];
  const authorNavigation = author.navigationEndpoint;

  return {
    title: UTIL.parseText(info.title),
    id: info.videoId,
    shortUrl: BASE_VIDEO_URL + info.videoId,
    url: new URL(info.navigationEndpoint.commandMetadata.webCommandMetadata.url, BASE_VIDEO_URL).toString(),
    author: {
      url: authorNavigation?.commandMetadata?.webCommandMetadata?.url
        ? new URL(authorNavigation.commandMetadata.webCommandMetadata.url, BASE_VIDEO_URL).toString()
        : null,
      channelID: authorNavigation?.browseEndpoint?.browseId || null,
      name: author.text,
    },
    thumbnail: info.thumbnail.thumbnails.sort((a, b) => b.width - a.width)[0].url,
    isLive,
    duration: !info.lengthText ? null : UTIL.parseText(info.lengthText),
  };
};
