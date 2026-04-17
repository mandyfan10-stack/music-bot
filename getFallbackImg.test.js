const getFallbackImg = require('./getFallbackImg');

describe('getFallbackImg', () => {
    it('returns the first two characters for a normal name', () => {
        const result = getFallbackImg('Abcde');
        expect(result).toBe('https://ui-avatars.com/api/?name=Ab&background=1c1c1e&color=fff&size=300');
    });

    it('returns a single character if the name has length 1', () => {
        const result = getFallbackImg('A');
        expect(result).toBe('https://ui-avatars.com/api/?name=A&background=1c1c1e&color=fff&size=300');
    });

    it('returns XX for an empty string', () => {
        const result = getFallbackImg('');
        expect(result).toBe('https://ui-avatars.com/api/?name=XX&background=1c1c1e&color=fff&size=300');
    });

    it('returns XX for null', () => {
        const result = getFallbackImg(null);
        expect(result).toBe('https://ui-avatars.com/api/?name=XX&background=1c1c1e&color=fff&size=300');
    });

    it('returns XX for undefined', () => {
        const result = getFallbackImg(undefined);
        expect(result).toBe('https://ui-avatars.com/api/?name=XX&background=1c1c1e&color=fff&size=300');
    });

    it('returns XX for the special string "Неизвестный релиз"', () => {
        const result = getFallbackImg('Неизвестный релиз');
        expect(result).toBe('https://ui-avatars.com/api/?name=XX&background=1c1c1e&color=fff&size=300');
    });

    it('correctly URL-encodes special characters in names', () => {
        const result = getFallbackImg('Иг');
        // 'Иг' URL encoded is %D0%98%D0%B3
        expect(result).toBe('https://ui-avatars.com/api/?name=%D0%98%D0%B3&background=1c1c1e&color=fff&size=300');
    });

    it('correctly handles names with spaces', () => {
        const result = getFallbackImg('A B');
        expect(result).toBe('https://ui-avatars.com/api/?name=A%20&background=1c1c1e&color=fff&size=300');
    });
});
