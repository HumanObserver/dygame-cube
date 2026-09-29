/**
 * 触摸输入：区分“点按”与“滑动”手势
 * - 点按（位移小、时间短）→ onTap(x, y)
 * - 滑动（位移足够大）→ onSwipe(dx, dy, startX, startY)
 */
class Input {
  constructor(TT) {
    this.onTap = null;
    this.onSwipe = null;
    this._start = null;
    if (!TT) return;
    try {
      TT.onTouchStart((e) => this._onStart(e));
      TT.onTouchMove((e) => this._onMove(e));
      TT.onTouchEnd((e) => this._onEnd(e));
      TT.onTouchCancel(() => { this._start = null; });
    } catch (e) { /* 平台不支持时忽略 */ }
  }

  _touch(e) {
    return e && e.touches && e.touches[0] ? e.touches[0] : null;
  }

  _onStart(e) {
    const t = this._touch(e);
    if (!t) return;
    this._start = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
  }

  _onMove(e) {
    if (!this._start) return;
    const t = this._touch(e);
    if (!t) return;
    if (Math.abs(t.clientX - this._start.x) > 12 || Math.abs(t.clientY - this._start.y) > 12) {
      this._start.moved = true;
    }
  }

  _onEnd(e) {
    const s = this._start;
    this._start = null;
    if (!s) return;
    const t = e && e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
    const x = t ? t.clientX : s.x;
    const y = t ? t.clientY : s.y;
    const dx = x - s.x;
    const dy = y - s.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!s.moved && dist < 14 && Date.now() - s.t < 600) {
      if (this.onTap) this.onTap(x, y);
    } else if (dist >= 26) {
      if (this.onSwipe) this.onSwipe(dx, dy, s.x, s.y);
    }
  }
}

module.exports = Input;
