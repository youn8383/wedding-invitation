// 랜덤 초대 링크 — /i/<code> (vercel.json rewrite) → 터미널 또는 레트로 청첩장으로 302
//  - 카카오톡은 주소별로 미리보기를 캐시하므로, 공유할 때마다 새 code 를 만들면 썸네일이 매번 랜덤이 됩니다.
//  - 같은 code 는 항상 같은 청첩장으로 보내므로, 카카오가 본 썸네일과 하객이 도착하는 페이지가 일치합니다.
const PAGES = { terminal: '/', retro: '/retro-game.html' };

// FNV-1a 32bit — code → 테마를 결정적으로 고름
function themeOf(code) {
    let h = 0x811c9dc5;
    for (let i = 0; i < code.length; i++) {
        h ^= code.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) % 2 ? 'retro' : 'terminal';
}

module.exports = (req, res) => {
    const code = String(req.query.code || '').slice(0, 32);
    const location = /^[a-z0-9]+$/i.test(code) ? PAGES[themeOf(code)] : PAGES.terminal;
    // 결과가 code 마다 고정이므로 길게 캐시해도 안전
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000');
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end();
};

module.exports.themeOf = themeOf;
