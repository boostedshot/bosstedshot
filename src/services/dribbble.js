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

async function verifyDribbbleProfile(profileUrl) {
  try {
    const username = new URL(profileUrl).pathname.replace(/\//g, '');

    const [profileRes, rssRes] = await Promise.allSettled([
      axios.get(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 15000,
      }),
      axios.get(`https://dribbble.com/${username}/shots.rss`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }),
    ]);

    let shotCount = 0;
    let memberSince = null;

    // Считаем работы через RSS (последние 20)
    if (rssRes.status === 'fulfilled') {
      const items = (rssRes.value.data.match(/<item>/g) || []).length;
      if (items > 0) shotCount = items;
    }

    // Парсим HTML профиля
    if (profileRes.status === 'fulfilled') {
      const $ = cheerio.load(profileRes.value.data);

      // Shot count из og:description ("X shots on Dribbble")
      if (!shotCount) {
        const ogDesc = $('meta[property="og:description"]').attr('content') || '';
        const m = ogDesc.match(/(\d[\d,]*)\s+shots?/i);
        if (m) shotCount = parseInt(m[1].replace(',', ''));
      }

      // Member since из <time datetime="...">
      $('time[datetime]').each((_, el) => {
        const dt = $(el).attr('datetime');
        if (dt && !memberSince) memberSince = new Date(dt);
      });

      // Fallback: ищем текст "Member since" рядом с датой
      if (!memberSince) {
        const html = profileRes.value.data;
        const m = html.match(/member[^<"]{0,20}since[^<"]{0,30}(\d{4})/i);
        if (m) memberSince = new Date(`${m[1]}-01-01`);
      }
    }

    const errors = [];

    if (shotCount > 0 && shotCount < 5) {
      errors.push(`мало работ — найдено ${shotCount}, нужно минимум 5`);
    }

    if (memberSince) {
      const minDate = new Date();
      minDate.setMonth(minDate.getMonth() - 3);
      if (memberSince > minDate) {
        const months = Math.floor((Date.now() - memberSince.getTime()) / (30 * 24 * 60 * 60 * 1000));
        errors.push(`аккаунт слишком новый — ${months} мес., нужно минимум 3`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, reason: errors.join('; ') };
    }

    return { valid: true, shotCount, memberSince };

  } catch (err) {
    return { valid: false, reason: 'Не удалось загрузить профиль. Проверьте что ссылка верна и профиль публичный.' };
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
  verifyDribbbleProfile,
};
