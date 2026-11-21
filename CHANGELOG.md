# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.16-local.3

### 中文

**修复**

- 修复自定义 shader 生效后整块预览变透明的问题：预览共享的 WebGL 上下文里，实例化批次会把顶点属性的分发除数留在槽位上，着色器通道复用同一个槽位时，整个全屏四边形只会读到一个顶点，纹理坐标塌缩成单点，采样结果整帧为空。着色器通道现在在绘制前把用到的属性分发除数归零。

### English

**Fixes**

- Custom shaders no longer blank the preview: in the preview's shared WebGL context an instanced batch can leave a vertex-attribute divisor on an attribute slot, so when the shader pass reused that slot every fragment of the full-screen quad read a single vertex, the texture coordinate collapsed to one point, and the whole frame sampled empty. The shader pass now clears the divisor on the slots it uses before drawing.
