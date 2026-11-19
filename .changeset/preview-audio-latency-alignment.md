---
"rpe-redux": patch
---

### 中文

**修复**

- 预览画面与音乐对齐：视觉时钟现在减去完整输出链路延迟（图内缓冲加设备缓冲），此前只减去其中一段，低倍速下能听出画面滞后。
- 停止播放时不再残留打击音：仍在解码的音效在停止后不再发声。

**改进**

- 波形在分析完成时按当前时间偏移绘制，不再先画一帧零偏移再纠正。
- BPM 与时间偏移输入框支持四档步进按钮，鼠标滚轮无需聚焦即可调整。

### English

**Fixes**

- Preview picture now lines up with the music: the visual clock subtracts the whole output chain (render graph plus device buffer) instead of only one stage, which was audible as the picture lagging at low playback rates.
- Hitting stop no longer leaves a hit sound playing: a sound still decoding when the transport stops stays silent.

**Improvements**

- The waveform paints at the current time offset when analysis completes, instead of drawing one frame at zero offset and correcting it later.
- BPM and time-offset fields accept four-step stepper buttons, and the mouse wheel adjusts them without focusing the field first.
