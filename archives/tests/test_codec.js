// Codec tests for helm.archives:
// 1. Create, list, readEntry, addEntriesToArchive, deleteEntriesFromArchive,
//    and extractEntries for .zip, .tar, and .tar.gz archives.
// 2. Implicit parent directory synthesis for archives storing only file entries.
// 3. Strict Zip Slip protection: rejects ../evil.txt, /abs/evil.txt, and drive paths
//    without writing any file outside the destination folder.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const { codec } = app;
const decoder = new TextDecoder();

let done = false;
let error = null;

(async () => {
  try {
    const srcDir = fixtureDir({
      'readme.md': '# Archive Manager\nPure JS ZIP and TAR.',
      'src/index.js': 'export const version = 1;\n'.repeat(20),
      'src/util/math.js': 'export const add = (a, b) => a + b;\n',
      'empty_dir/': null,
    });

    const workDir = fixtureDir({
      'extra.txt': 'newly added file content',
    });

    for (const fmt of ['zip', 'tar', 'tar.gz']) {
      const ext = fmt === 'tar.gz' ? '.tar.gz' : `.${fmt}`;
      const archiveFile = path.join(workDir, `sample${ext}`);

      // 1. Create archive from disk inputs
      const created = await codec.createArchive(archiveFile, [
        path.join(srcDir, 'readme.md'),
        path.join(srcDir, 'src'),
        path.join(srcDir, 'empty_dir'),
      ], { format: fmt });
      eq(created.format, fmt, `${fmt}: created format matches`);
      assert(fs.existsSync(archiveFile), `${fmt}: archive file exists on disk`);

      // 2. List / read archive metadata
      const info = await codec.readArchive(archiveFile);
      eq(info.format, fmt, `${fmt}: detected format matches`);
      const entryPaths = info.entries.map((e) => e.path).sort();
      eq(entryPaths, [
        'empty_dir',
        'readme.md',
        'src',
        'src/index.js',
        'src/util',
        'src/util/math.js',
      ], `${fmt}: listed entries match expected tree`);

      // 3. Read single entry bytes without full extraction
      const readmeBytes = await codec.readEntry(info, 'readme.md');
      eq(decoder.decode(readmeBytes), '# Archive Manager\nPure JS ZIP and TAR.', `${fmt}: readEntry readme.md`);

      const mathBytes = await codec.readEntry(archiveFile, 'src/util/math.js');
      eq(decoder.decode(mathBytes), 'export const add = (a, b) => a + b;\n', `${fmt}: readEntry nested file`);

      // 4. Add a file to the existing archive
      await codec.addEntriesToArchive(archiveFile, [path.join(workDir, 'extra.txt')], { targetDir: 'src' });
      const afterAdd = await codec.readArchive(archiveFile);
      assert(afterAdd.entries.some((e) => e.path === 'src/extra.txt'), `${fmt}: added entry src/extra.txt present`);
      const extraBytes = await codec.readEntry(afterAdd, 'src/extra.txt');
      eq(decoder.decode(extraBytes), 'newly added file content', `${fmt}: added entry content matches`);

      // 5. Delete an entry from the existing archive
      await codec.deleteEntriesFromArchive(archiveFile, ['src/util']);
      const afterDel = await codec.readArchive(archiveFile);
      assert(!afterDel.entries.some((e) => e.path === 'src/util' || e.path === 'src/util/math.js'),
        `${fmt}: deleted directory and its children removed`);
      assert(afterDel.entries.some((e) => e.path === 'readme.md'), `${fmt}: untouched entry preserved after delete`);

      // 6. Extract archive to destination folder
      const extractDest = path.join(workDir, `extracted-${fmt.replace('.', '_')}`);
      const extRes = await codec.extractEntries(archiveFile, extractDest);
      assert(extRes.extractedCount >= 3, `${fmt}: extracted files count`);
      eq(fs.readFileSync(path.join(extractDest, 'readme.md'), 'utf8'),
        '# Archive Manager\nPure JS ZIP and TAR.', `${fmt}: extracted readme.md content`);
      eq(fs.readFileSync(path.join(extractDest, 'src', 'extra.txt'), 'utf8'),
        'newly added file content', `${fmt}: extracted src/extra.txt content`);
      assert(fs.existsSync(path.join(extractDest, 'empty_dir')), `${fmt}: extracted empty_dir exists`);
    }

    // 7. Implicit parent directory synthesis when archive only has leaf file paths
    const leafOnlyZip = path.join(workDir, 'leaf-only.zip');
    await codec.writeArchiveEntries(leafOnlyZip, [
      { path: 'a/b/c/deep.txt', isDirectory: false, data: 'deep leaf' },
    ], { format: 'zip' });
    const leafArchive = await codec.readArchive(leafOnlyZip);
    eq(leafArchive.entries.map((e) => e.path), ['a', 'a/b', 'a/b/c', 'a/b/c/deep.txt'],
      'implicit parent directories synthesized for leaf-only archive');
    assert(leafArchive.entries.find((e) => e.path === 'a/b').isDirectory, 'synthesized parent is marked directory');

    // 8. Zip Slip security protection tests (.zip and .tar)
    const outsideTarget = path.join(workDir, 'evil.txt');
    const safeExtractDir = path.join(workDir, 'safe-target');

    for (const fmt of ['zip', 'tar']) {
      for (const maliciousPath of ['../evil.txt', 'sub/../../evil.txt', '/abs/evil.txt', '\\abs\\evil.txt', 'C:\\evil.txt']) {
        const badArchivePath = path.join(workDir, `bad-${fmt}-${ Math.random().toString(36).slice(2, 7)}.${fmt}`);
        await codec.writeArchiveEntries(badArchivePath, [
          { path: 'ok.txt', isDirectory: false, data: 'safe' },
          { path: maliciousPath, isDirectory: false, data: 'pwned' },
        ], { format: fmt });

        let threw = false;
        try {
          await codec.extractEntries(badArchivePath, safeExtractDir);
        } catch (err) {
          threw = /Zip Slip|Unsafe archive entry path/i.test(err.message);
        }
        assert(threw, `${fmt} rejected malicious path "${maliciousPath}"`);
        assert(!fs.existsSync(outsideTarget), `outside file never written for "${maliciousPath}"`);
      }
    }

    done = true;
  } catch (err) {
    error = err;
    done = true;
  }
})();

waitFor(() => done, 'codec async tests to complete');
if (error) throw error;
console.log('test_codec PASSED');
