function getFallbackImg(name) {
    const safeName = name && name !== 'Неизвестный релиз' ? name.substring(0, 2) : 'XX';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=1c1c1e&color=fff&size=300`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = getFallbackImg;
}
