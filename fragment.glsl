#version 300 es
precision mediump float;
uniform vec3 u_Color;
out vec4 fragColor;

void main() {
  fragColor = vec4(u_Color, 1.0);
  if (gl_FrontFacing) {
    fragColor.rgb *= 1.0; // Цвет для лицевой стороны. Добавлено для теста
  } else {
    fragColor.rgb *= 1.0;
  }
}