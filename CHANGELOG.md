# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.16-local.5

### 中文

**修复**

- 修复自定义 shader 生效后整块预览变透明的问题：预览共享的 WebGL 上下文里，实例化批次会把顶点属性的分发除数留在槽位上，着色器通道复用同一个槽位时，整个全屏四边形只会读到一个顶点，纹理坐标塌缩成单点，采样结果整帧为空。着色器通道现在在绘制前把用到的属性分发除数归零。
- 修复带歌词的谱面里判定线整体消失的问题：判定线能否交给 GPU 批次统一绘制，原本还要求"所有判定线都没有歌词事件"，于是谱面里只要有一条带 `textEvents` 的歌词线，全部判定线一起退回 Canvas 绘制；而着色器通道把那张画布压到透明度 0，判定线就全看不见了。歌词只是这条线上的字幕，由独立的绘制步骤输出，与判定线怎么画无关，现在判定线是否进批次只由贴图决定，歌词仍照常绘制。
- 修复框选音符时背景着色器立刻失效、判定线变透明的问题：预览把同一张画布和同一个 WebGL 上下文同时交给实例化批次和着色器通道，实例化批次每一帧都按设备像素比把这张画布调成 `1081×763`，着色器通道随后又按逻辑尺寸改回 `865×610`。尺寸每帧被改写两次，对应的纹理就被重新分配两次，内容清零；而纹理上传缓存只比较绘制修订号，认为上传仍然有效，于是着色器通道整帧采样到刚被清空的纹理，输出全透明。现在共享画布由着色器通道独占尺寸，实例化批次记录已有尺寸而不再改写它；纹理重新分配时同时作废上传缓存。

### English

**Fixes**

- Custom shaders no longer blank the preview: in the preview's shared WebGL context an instanced batch can leave a vertex-attribute divisor on an attribute slot, so when the shader pass reused that slot every fragment of the full-screen quad read a single vertex, the texture coordinate collapsed to one point, and the whole frame sampled empty. The shader pass now clears the divisor on the slots it uses before drawing.
- Judge lines no longer vanish on charts that carry lyrics: routing every judge line through the shared GPU batch used to require that no line had lyric events, so one line with `textEvents` sent all of them to the Canvas path, and the shader path keeps that canvas at zero opacity, leaving no judge line visible. Lyrics are a subtitle on that one line, painted by a step of their own, and say nothing about how a line is drawn, so the batch now depends only on the line texture and the lyrics still paint.
- Selecting notes no longer kills the background shader or blanks the judge lines: the preview handed the same canvas and the same WebGL context to both the instanced batch and the shader pass. The batch resized that canvas to the device-pixel size `1081×763` every frame and the shader pass resized it back to the logical `865×610`, so the surface was reassigned twice per frame and every shader texture was reallocated and cleared, while the upload cache still reported the previous upload as valid. The shader pass now owns the size of the shared canvas, the instanced batch adopts the existing size instead of rewriting it, and a texture reallocation invalidates the upload cache.
