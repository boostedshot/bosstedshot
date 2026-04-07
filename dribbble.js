const axios = require('axios');
const cheerio = require('cheerio');

const DRIBBBLE_BASE = 'https://dribbble.com';

function isDribbbleUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'dribbble.com';
  } catch {
    return false;
  }
}

function isShotUrl(url) {
  return isDribbbleUrl(url) && url.includes('/shots/');
}

function isProfileUrl(url) {
  if (!isDribbbleUrl(url)) return false;
  const path = new URL(url).pathname;
  const parts = path.split('/').filter(Boolean);
  return parts.length === 1;
}

function normalizeDribbbleUrl(url) {
  if (!url.startsWith('http')) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('dribbble.com')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function checkLike(shotUrl, username) {
  // In production: use Dribbble API or authenticated scraping
  // MVP: return pending for manual review, or implement basic check
  try {
    const response = await axios.get(shotUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DribbbleBot/1.0)',
      },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);
    
    // Basic check: look for like count changes (simplified for MVP)
    // In production you'd compare before/after or use API
    const likeCount = parseInt($('[data-likes-count]').attr('data-likes-count') || '0');
    
    // For MVP, we trust users and do periodic spot checks
    return { verified: true, likeCount };
  } catch (err) {
    console.error('Dribbble check error:', err.message);
    return { verified: false, error: err.message };
  }
}

async function checkComment(shotUrl, username, expectedText) {
  try {
    const response = await axios.get(shotUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DribbbleBot/1.0)',
      },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);
    
    // Look for comment from username
    let found = false;
    $('.comment-content').each((_, el) => {
      const commentUser = $(el).find('.username').text().toLowerCase().trim();
      const commentText = $(el).find('.comment-text').text().toLowerCase().trim();
      if (commentUser === username.toLowerCase() || 
          (expectedText && commentText.includes(expectedText.toLowerCase()))) {
        found = true;
      }
    });
    
    return { verified: found };
  } catch (err) {
    return { verified: false, error: err.message };
  }
}

async function getShotInfo(shotUrl) {
  try {
    const response = await axios.get(shotUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DribbbleBot/1.0)',
      },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);
    
    return {
      title: $('h1').first().text().trim() || 'Dribbble shot',
      thumbnail: $('meta[property="og:image"]').attr('content') || null,
      author: $('meta[name="author"]').attr('content') || 'Unknown',
    };
  } catch {
    return { title: 'Dribbble shot', thumbnail: null, author: 'Unknown' };
  }
}

module.exports = {
  isDribbbleUrl,
  isShotUrl,
  isProfileUrl,
  normalizeDribbbleUrl,
  checkLike,
  checkComment,
  getShotInfo,
};
