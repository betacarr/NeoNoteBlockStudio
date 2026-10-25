import assert from 'node:assert/strict';

/** Original class-file structure; no external or inferred name mappings. */
export function historicalClassfile(input) {
  const bytes = Buffer.from(input); assert.equal(bytes.readUInt32BE(0), 0xcafebabe); let at = 8;
  const u1 = () => bytes.readUInt8(at++), u2 = () => { const value = bytes.readUInt16BE(at); at += 2; return value; }, u4 = () => { const value = bytes.readUInt32BE(at); at += 4; return value; };
  const pool = new Array(u2());
  for (let i = 1; i < pool.length; i++) {
    const tag = u1();
    if (tag === 1) { const size = u2(); pool[i] = { tag, value: bytes.toString('utf8', at, at + size) }; at += size; }
    else if ([7, 8, 16, 19, 20].includes(tag)) pool[i] = { tag, index: u2() };
    else if ([9, 10, 11, 12, 17, 18].includes(tag)) pool[i] = { tag, first: u2(), second: u2() };
    else if ([3, 4].includes(tag)) { pool[i] = { tag, value: tag === 3 ? bytes.readInt32BE(at) : bytes.readFloatBE(at) }; at += 4; }
    else if ([5, 6].includes(tag)) { pool[i] = { tag, value: tag === 6 ? bytes.readDoubleBE(at) : bytes.readBigInt64BE(at).toString() }; at += 8; i++; }
    else if (tag === 15) pool[i] = { tag, kind: u1(), index: u2() };
    else throw new Error(`Unexpected original constant-pool tag ${tag}`);
  }
  const text = index => pool[index]?.value, className = index => text(pool[index]?.index);
  const access = u2(), name = className(u2()), parent = className(u2()), interfaces = Array.from({ length: u2() }, () => className(u2()));
  const attributes = () => Array.from({ length: u2() }, () => { const name = text(u2()), size = u4(), value = bytes.subarray(at, at + size); at += size; return { name, value }; });
  const members = () => Array.from({ length: u2() }, () => ({ access: u2(), name: text(u2()), descriptor: text(u2()), attributes: attributes() }));
  const fields = members(), methods = members(); attributes(); assert.equal(at, bytes.length);
  const refs = pool.filter(entry => entry && [9, 10, 11].includes(entry.tag)).map(entry => ({ kind: entry.tag === 9 ? 'field' : 'method', owner: className(entry.first), name: text(pool[entry.second].first), descriptor: text(pool[entry.second].second) }));
  return { name, parent, access, interfaces, fields, methods, refs,
    utf8: pool.filter(entry => entry?.tag === 1).map(entry => entry.value),
    strings: pool.filter(entry => entry?.tag === 8).map(entry => text(entry.index)),
    floats: pool.filter(entry => entry?.tag === 4).map(entry => entry.value),
  };
}
