#version 300 es
uniform mat4 u_mvpMatrix;
uniform float depthOffset;
layout(location = 0) in vec3 a_Position;

void main() {
  vec4 pos = u_mvpMatrix * vec4(a_Position, 1.0);
  pos.z += depthOffset;
  gl_Position = pos;
}