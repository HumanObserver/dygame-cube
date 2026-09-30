/**
 * fix-mp4-duration.cjs — 修复 Chrome MediaRecorder(timeslice) 产出的 fragmented MP4
 * 时长元数据：扫描全部 moof→traf→(tfhd/tfdt/trun) 样本时长，按轨道求和，
 * 回填 moov 内 mvhd / tkhd / mdhd 的 duration 字段（就地修改文件）。
 *
 * 用法（CLI）：node tools/fix-mp4-duration.cjs videos/xxx.mp4
 * 用法（模块）：const { patchFile } = require('../tools/fix-mp4-duration.cjs'); patchFile(f)
 *
 * 仅处理 Chrome 常见结构（32位 box size，v1 头部 mvhd/tkhd/mdhd，trun flag 组合）。
 * 非 fMP4 或结构不认识时静默跳过（返回 null），不破坏原文件。
 */
'use strict';
const fs = require('fs');

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'mvex', 'moof', 'traf']);

/** 递归收集 box 偏移 */
function walk(buf, start, end, depth, out) {
  let off = start;
  while (off + 8 <= end) {
    let sz = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    let hdr = 8;
    if (sz === 1) { sz = Number(buf.readBigUInt64BE(off + 8)); hdr = 16; }
    if (sz < 8 || off + sz > end) return; // 结构不认识 → 放弃
    out.push({ type, off, hdr, end: off + sz });
    if (CONTAINERS.has(type)) walk(buf, off + hdr, off + sz, depth + 1, out);
    off += sz;
  }
}

function u64(buf, off) { return Number(buf.readBigUInt64BE(off)); }

/**
 * @param file mp4 路径（就地修改）
 * @returns {null|{movieMs, tracks:[{id, mediaDur, timescale, seconds}]}}
 */
function patchFile(file) {
  const buf = fs.readFileSync(file);
  const boxes = [];
  walk(buf, 0, buf.length, 0, boxes);

  const mvhd = boxes.find((b) => b.type === 'mvhd');
  const moofCount = boxes.filter((b) => b.type === 'moof').length;
  if (!mvhd || moofCount === 0) return null; // 非 fMP4，不动

  // mvhd：movie timescale
  const mvVer = buf.readUInt8(mvhd.off + mvhd.hdr);
  const mvhdBody = mvhd.off + mvhd.hdr;
  let mvTimescale;
  if (mvVer === 1) mvTimescale = buf.readUInt32BE(mvhdBody + 20);
  else mvTimescale = buf.readUInt32BE(mvhdBody + 12);

  // 各轨道样本时长求和：遍历每个 moof 的 traf
  const trackDur = new Map(); // trackID → total media-time units
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].type !== 'traf') continue;
    const trafStart = boxes[i].off + boxes[i].hdr;
    const trafEnd = boxes[i].end;
    let tfhd = null, trun = null;
    for (let j = i + 1; j < boxes.length && boxes[j].off < trafEnd; j++) {
      if (boxes[j].type === 'tfhd') tfhd = boxes[j];
      if (boxes[j].type === 'trun') trun = boxes[j];
    }
    if (!tfhd || !trun) continue;
    const tfhdBody = tfhd.off + tfhd.hdr;
    // fullbox flags = 24bit：readUInt32BE & 0xffffff（不能把 version 混进来）
    const tfFlags = buf.readUInt32BE(tfhdBody) & 0xffffff;
    const trackId = buf.readUInt32BE(tfhdBody + 4);
    // tfhd: 0x1 base_sample_index(4B) → 0x2 default_sample_duration
    let defDur = 0;
    {
      let p = tfhdBody + 8;
      if (tfFlags & 0x000001) p += 4;
      if (tfFlags & 0x000002) defDur = buf.readUInt32BE(p);
    }
    const trunBody = trun.off + trun.hdr;
    // trun: 头内 0x1 data_offset / 0x4 first_sample_flags；
    //       每样本 0x100 duration / 0x200 size / 0x400 offset / 0x800 cts
    const trFlags = buf.readUInt32BE(trunBody) & 0xffffff;
    const count = buf.readUInt32BE(trunBody + 4);
    let pos = trunBody + 8;
    if (trFlags & 0x000001) pos += 4; // data offset
    if (trFlags & 0x000004) pos += 4; // first sample flags
    let sum = 0;
    for (let k = 0; k < count; k++) {
      if (trFlags & 0x000100) { sum += buf.readUInt32BE(pos); pos += 4; }
      else sum += defDur;
      if (trFlags & 0x000200) pos += 4; // sample size
      if (trFlags & 0x000400) pos += 4; // sample offset
      if (trFlags & 0x000800) pos += 4; // sample cts
    }
    trackDur.set(trackId, (trackDur.get(trackId) || 0) + sum);
  }
  if (!trackDur.size) return null;

  // 回填 tkhd / mdhd / mvhd
  let movieDur = 0;
  const info = [];
  const traks = boxes.filter((b) => b.type === 'trak');
  for (const t of traks) {
    const tkhd = boxes.find((b) => b.type === 'tkhd' && b.off > t.off && b.off < t.end);
    const mdhd = boxes.find((b) => b.type === 'mdhd' && b.off > t.off && b.off < t.end);
    if (!tkhd || !mdhd) continue;
    const tkBody = tkhd.off + tkhd.hdr;
    const tkVer = buf.readUInt8(tkBody);
    // v0: trackID@12(ver+flags4+ctime4+mtime4)，duration@20；v1: trackID@20(ctime/mtime 各 8B)，duration@28
    const trackId = buf.readUInt32BE(tkBody + (tkVer === 1 ? 20 : 12));
    const mdBody = mdhd.off + mdhd.hdr;
    const mdVer = buf.readUInt8(mdBody);
    const timescale = mdVer === 1 ? buf.readUInt32BE(mdBody + 20) : buf.readUInt32BE(mdBody + 12);
    const total = trackDur.get(trackId) || 0;
    const durMs = Math.round((total / timescale) * mvTimescale);
    if (mdVer === 1) buf.writeBigUInt64BE(BigInt(total), mdBody + 24);
    else buf.writeUInt32BE(total & 0xffffffff, mdBody + 16);
    if (tkVer === 1) buf.writeBigUInt64BE(BigInt(durMs), tkBody + 28);
    else buf.writeUInt32BE(durMs & 0xffffffff, tkBody + 20);
    if (durMs > movieDur) movieDur = durMs;
    info.push({ id: trackId, seconds: +(total / timescale).toFixed(3) });
  }
  if (mvVer === 1) buf.writeBigUInt64BE(BigInt(movieDur), mvhdBody + 24);
  else buf.writeUInt32BE(movieDur & 0xffffffff, mvhdBody + 16);

  fs.writeFileSync(file, buf);
  return { movieMs: movieDur, tracks: info };
}

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.log('usage: node tools/fix-mp4-duration.cjs <file.mp4>'); process.exit(1); }
  const r = patchFile(f);
  console.log(JSON.stringify(r || { skipped: 'not fragmented mp4 / unknown structure' }));
}

module.exports = { patchFile };
