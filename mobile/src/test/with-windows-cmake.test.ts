/**
 * The Windows CMake choice behind plugins/with-windows-cmake.js. Reanimated's
 * object paths pass 260 characters; the ninja bundled with CMake 3.22 fails on
 * them even with long paths enabled, the one in 3.31 does not. android/ is
 * generated, so the choice is made by a config plugin, not by hand.
 */
import { mergeProperties, pickCmake } from '../../plugins/windows-cmake';

describe('pickCmake', () => {
  it('picks the newest CMake at or above 3.31', () => {
    expect(pickCmake(['3.22.1', '3.31.6', '3.31.10', '3.30.5'])).toBe('3.31.10');
    expect(pickCmake(['4.0.2', '3.31.6'])).toBe('4.0.2');
  });

  it('picks none when only older ones are installed', () => {
    expect(pickCmake(['3.22.1', '3.30.5'])).toBeNull();
    expect(pickCmake([])).toBeNull();
  });

  it('ignores folders that are not versions', () => {
    expect(pickCmake(['.temp', 'latest', '3.31.6'])).toBe('3.31.6');
  });
});

describe('mergeProperties', () => {
  it('sets the keys and keeps every other line', () => {
    const before = '# local\nndk.dir=C\\:/ndk\nsdk.dir=old\n';
    const after = mergeProperties(before, { 'sdk.dir': 'C:/sdk', 'cmake.dir': 'C:/sdk/cmake/3.31.6' });
    expect(after.split('\n')).toEqual([
      '# local', 'ndk.dir=C\\:/ndk', 'sdk.dir=C:/sdk', 'cmake.dir=C:/sdk/cmake/3.31.6', '',
    ]);
  });

  it('writes a file from nothing', () => {
    expect(mergeProperties('', { 'cmake.dir': 'C:/x' })).toBe('cmake.dir=C:/x\n');
  });

  it('gives the same file when run twice', () => {
    const once = mergeProperties('a=1\n', { 'cmake.dir': 'C:/x' });
    expect(mergeProperties(once, { 'cmake.dir': 'C:/x' })).toBe(once);
  });

  it('writes paths with forward slashes', () => {
    expect(mergeProperties('', { 'sdk.dir': 'C:\\Users\\me\\Sdk' })).toBe('sdk.dir=C:/Users/me/Sdk\n');
  });
});
