// main.js (вариант 2 – каретка вдоль Z, лента с чёрными кромками,
// исправленная пауза, счётчик слоёв, выбор проекции, управление памятью)
"use strict";

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
let canvas, gl, program;
let u_mvpMatrix, u_color;

// Геометрия оправки
let mandrelVertices, mandrelIndices;
let pathPoints = [];
let totalTheta = 0;
let beta0 = 0;

// Накопленные точки текущего слоя (локальные координаты оправки)
let currentLayerPoints = [];
// Массив завершённых слоёв (каждый элемент – массив точек)
let completedLayers = [];

// Буферы
let mandrelVAO, mandrelVBO, mandrelIBO;
let tapeVAO, tapeVBO;
let leftEdgeVAO, leftEdgeVBO, leftEdgeCount = 0;
let rightEdgeVAO, rightEdgeVBO, rightEdgeCount = 0;
let markerVAO, markerCount;
let lineVAO, lineVBO;
const MAX_TRACE_POINTS = 400000; // оставлен для совместимости, но не используется для лимита слоёв
const CLEARANCE = 0.5;

// Параметры
const params = {
  R: 1.5,
  L: 4.0,
  rn: 0.4,
  tapeWidth: 0.15,
  speed: 0.5,
  pause: false,
  maxLayers: 5,   // максимальное количество отображаемых слоёв
  renderMode: 'polygons'
};

// Анимация
let animationTime = 0;          // накопленное время анимации (сек), растёт только без паузы
let lastFrameTime = performance.now();
let omega = 0;
let lastCarriageIdx = 0;
let currentDirection = 'forward';
let activePhaseOffset = 0;
let phiL = 0;
let numPoints = 0;
let layerCount = 0;
let lastSavedLayerPhase = 0;    // фазовый сдвиг, при котором был сохранён последний слой

// Камера
let cameraAzimuth = 0.7;
let cameraElevation = 0.5;
let cameraDistance = 9.0;
let cameraTarget = [0, 0, 0];
let mouseDown = false;
let lastMouseX, lastMouseY;
let manualCameraActive = true;

// ==================== ЗАГРУЗКА ШЕЙДЕРОВ ====================
async function loadShaderSource(url) {
  const response = await fetch(url);
  return response.text();
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

async function initWebGL() {
  canvas = document.getElementById('webgl');
  gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    alert('WebGL2 не поддерживается');
    return false;
  }

  const vsSource = await loadShaderSource('vertex.glsl');
  const fsSource = await loadShaderSource('fragment.glsl');

  const vShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  program = gl.createProgram();
  gl.attachShader(program, vShader);
  gl.attachShader(program, fShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return false;
  }
  gl.useProgram(program);
  u_mvpMatrix = gl.getUniformLocation(program, 'u_mvpMatrix');
  u_color = gl.getUniformLocation(program, 'u_Color');

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.95, 0.95, 0.95, 1.0);
  return true;
}

// ==================== ПОСТРОЕНИЕ ОПРАВКИ ====================
function buildMandrelGeometry() {
  const R = params.R;
  const L = params.L;
  const rn = params.rn;
  const domeH = Math.sqrt(R * R - rn * rn);
  const zCylStart = -L / 2;
  const zCylEnd = L / 2;
  const zLeftStart = zCylStart - domeH;
  const zRightEnd = zCylEnd + domeH;

  const stepsAng = 60;
  const stepsCyl = 20;
  const stepsDome = 15;

  const verts = [];
  const idxs = [];

  function addRing(z, r) {
    for (let i = 0; i < stepsAng; i++) {
      const angle = (i / stepsAng) * Math.PI * 2;
      verts.push(r * Math.cos(angle), r * Math.sin(angle), z);
    }
  }

  // Левое днище
  for (let j = 0; j <= stepsDome; j++) {
    const t = j / stepsDome;
    const z = zLeftStart + t * domeH;
    const r = Math.sqrt(R * R - (z - zCylStart) * (z - zCylStart));
    addRing(z, r);
  }
  const leftBase = 0;
  const leftRings = stepsDome + 1;

  // Цилиндр
  const cylBase = verts.length / 3;
  for (let j = 0; j <= stepsCyl; j++) {
    const t = j / stepsCyl;
    const z = zCylStart + t * (zCylEnd - zCylStart);
    addRing(z, R);
  }
  const cylRings = stepsCyl + 1;

  // Правое днище
  const rightBase = verts.length / 3;
  for (let j = 0; j <= stepsDome; j++) {
    const t = j / stepsDome;
    const z = zCylEnd + t * domeH;
    const r = Math.sqrt(R * R - (z - zCylEnd) * (z - zCylEnd));
    addRing(z, r);
  }
  const rightRings = stepsDome + 1;

  function addQuads(baseRing, rings) {
    for (let i = 0; i < rings - 1; i++) {
      const curr = baseRing + i * stepsAng;
      const next = curr + stepsAng;
      for (let j = 0; j < stepsAng; j++) {
        const jNext = (j + 1) % stepsAng;
        idxs.push(curr + j, next + j, curr + jNext);
        idxs.push(curr + jNext, next + j, next + jNext);
      }
    }
  }

  addQuads(leftBase, leftRings);
  addQuads(cylBase, cylRings);
  addQuads(rightBase, rightRings);

  mandrelVertices = new Float32Array(verts);
  mandrelIndices = new Uint16Array(idxs);
}

// ==================== ГЕОДЕЗИЧЕСКАЯ ТРАЕКТОРИЯ ====================
function computeGeodesicPath() {
  const R = params.R;
  const L = params.L;
  const rn = params.rn;
  const domeH = Math.sqrt(R * R - rn * rn);
  const zStart = -L / 2 - domeH;
  const zEnd = L / 2 + domeH;
  const c = rn;
  const dz = 0.01;
  const maxSteps = 50000;

  pathPoints = [];
  let theta = 0;
  let z = zStart;
  let steps = 0;

  // Левое днище
  while (z < -L / 2 && steps < maxSteps) {
    const zc = -L / 2;
    const dzPart = Math.min(dz, -L / 2 - z);
    const r2 = R * R - (z - zc) * (z - zc);
    if (r2 <= 0) break;
    const r = Math.sqrt(r2);
    const rp = -(z - zc) / r;
    const denom = Math.sqrt(1 - c * c / (r * r));
    if (denom < 1e-6 || isNaN(denom)) { z += dzPart; steps++; continue; }
    const sqrt1rp2 = Math.sqrt(1 + rp * rp);
    const dthetadz = (c / (r * r)) * sqrt1rp2 / denom;
    theta += dthetadz * dzPart;
    pathPoints.push({ theta, z, r });
    z += dzPart;
    steps++;
  }

  // Цилиндр
  beta0 = Math.asin(rn / R);
  const dthetadzCyl = Math.tan(beta0) / R;
  let zCyl = -L / 2;
  while (zCyl < L / 2 && steps < maxSteps) {
    const dzPart = Math.min(dz, L / 2 - zCyl);
    theta += dthetadzCyl * dzPart;
    pathPoints.push({ theta, z: zCyl, r: R });
    zCyl += dzPart;
    steps++;
  }

  // Правое днище
  z = L / 2;
  while (z < zEnd && steps < maxSteps) {
    const zc = L / 2;
    const dzPart = Math.min(dz, zEnd - z);
    const r2 = R * R - (z - zc) * (z - zc);
    if (r2 <= 0) break;
    const r = Math.sqrt(r2);
    const rp = -(z - zc) / r;
    const denom = Math.sqrt(1 - c * c / (r * r));
    if (denom < 1e-6 || isNaN(denom)) { z += dzPart; steps++; continue; }
    const sqrt1rp2 = Math.sqrt(1 + rp * rp);
    const dthetadz = (c / (r * r)) * sqrt1rp2 / denom;
    theta += dthetadz * dzPart;
    pathPoints.push({ theta, z, r });
    z += dzPart;
    steps++;
  }

  totalTheta = theta;
  numPoints = pathPoints.length;

  if (Math.cos(beta0) > 0.001) {
    phiL = params.tapeWidth / (params.R * Math.cos(beta0));
  } else {
    phiL = 0.2;
  }
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function forwardWorld(i, offset) {
  const pt = pathPoints[i];
  const theta = pt.theta + offset;
  return [pt.r * Math.cos(theta), pt.r * Math.sin(theta), pt.z];
}

function backwardWorld(i, offset) {
  const pt = pathPoints[numPoints - 1 - i];
  const theta = -pt.theta + offset;
  return [pt.r * Math.cos(theta), pt.r * Math.sin(theta), pt.z];
}

function normalFromWorld(x, y, z) {
  const R = params.R;
  const L = params.L;
  if (z <= -L/2) {
    const zc = -L/2;
    const len = Math.sqrt(x*x + y*y + (z - zc)*(z - zc));
    return [x/len, y/len, (z - zc)/len];
  } else if (z >= L/2) {
    const zc = L/2;
    const len = Math.sqrt(x*x + y*y + (z - zc)*(z - zc));
    return [x/len, y/len, (z - zc)/len];
  } else {
    const r = Math.sqrt(x*x + y*y);
    return [x/r, y/r, 0];
  }
}

// Объединяет завершённые слои и текущий слой в единый массив точек
function getAllPoints() {
  let all = [];
  for (let layer of completedLayers) {
    all = all.concat(layer);
  }
  return all.concat(currentLayerPoints);
}

function updateTapeAndEdges() {
  const points = getAllPoints();
  if (points.length < 2) {
    leftEdgeCount = 0;
    rightEdgeCount = 0;
    return;
  }
  const halfW = params.tapeWidth * 0.5;
  const verts = [];
  const leftLine = [];
  const rightLine = [];

  for (let i = 0; i < points.length; i++) {
    const P = points[i];
    const normal = normalFromWorld(P[0], P[1], P[2]);
    const nx = normal[0], ny = normal[1], nz = normal[2];

    let tx, ty, tz;
    if (i < points.length - 1) {
      const next = points[i+1];
      const dx = next[0] - P[0], dy = next[1] - P[1], dz = next[2] - P[2];
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (len > 1e-6) { tx = dx/len; ty = dy/len; tz = dz/len; }
      else { tx = 1; ty = 0; tz = 0; }
    } else {
      const prev = points[i-1];
      const dx = P[0] - prev[0], dy = P[1] - prev[1], dz = P[2] - prev[2];
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (len > 1e-6) { tx = dx/len; ty = dy/len; tz = dz/len; }
      else { tx = 1; ty = 0; tz = 0; }
    }

    const bx = ny*tz - nz*ty;
    const by = nz*tx - nx*tz;
    const bz = nx*ty - ny*tx;
    const lenB = Math.sqrt(bx*bx + by*by + bz*bz);
    if (lenB < 1e-6) {
      verts.push(P[0], P[1], P[2], P[0], P[1], P[2]);
      leftLine.push(P[0], P[1], P[2]);
      rightLine.push(P[0], P[1], P[2]);
      continue;
    }
    const bnx = bx / lenB, bny = by / lenB, bnz = bz / lenB;
    const leftX = P[0] - halfW * bnx;
    const leftY = P[1] - halfW * bny;
    const leftZ = P[2] - halfW * bnz;
    const rightX = P[0] + halfW * bnx;
    const rightY = P[1] + halfW * bny;
    const rightZ = P[2] + halfW * bnz;
    verts.push(leftX, leftY, leftZ, rightX, rightY, rightZ);
    leftLine.push(leftX, leftY, leftZ);
    rightLine.push(rightX, rightY, rightZ);
  }

  // Обновление полосы
  gl.bindBuffer(gl.ARRAY_BUFFER, tapeVBO);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(verts));

  // Левый край
  gl.bindBuffer(gl.ARRAY_BUFFER, leftEdgeVBO);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(leftLine));
  leftEdgeCount = leftLine.length / 3;

  // Правый край
  gl.bindBuffer(gl.ARRAY_BUFFER, rightEdgeVBO);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(rightLine));
  rightEdgeCount = rightLine.length / 3;
}

// ==================== БУФЕРЫ ====================
function setupMandrelBuffers() {
  if (mandrelVAO) gl.deleteVertexArray(mandrelVAO);
  mandrelVAO = gl.createVertexArray();
  gl.bindVertexArray(mandrelVAO);

  mandrelVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, mandrelVBO);
  gl.bufferData(gl.ARRAY_BUFFER, mandrelVertices, gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  mandrelIBO = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mandrelIBO);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mandrelIndices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
}

function setupTapeBuffer() {
  if (tapeVAO) gl.deleteVertexArray(tapeVAO);
  tapeVAO = gl.createVertexArray();
  gl.bindVertexArray(tapeVAO);

  tapeVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tapeVBO);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_TRACE_POINTS * 2 * 3 * 4, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindVertexArray(null);
}

function setupEdgeBuffers() {
  if (leftEdgeVAO) gl.deleteVertexArray(leftEdgeVAO);
  leftEdgeVAO = gl.createVertexArray();
  gl.bindVertexArray(leftEdgeVAO);
  leftEdgeVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, leftEdgeVBO);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_TRACE_POINTS * 3 * 4, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindVertexArray(null);

  if (rightEdgeVAO) gl.deleteVertexArray(rightEdgeVAO);
  rightEdgeVAO = gl.createVertexArray();
  gl.bindVertexArray(rightEdgeVAO);
  rightEdgeVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rightEdgeVBO);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_TRACE_POINTS * 3 * 4, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindVertexArray(null);
}

function buildMarkerGeometry() { // создание геометрии каретки, lat - lon - количество разбиений.
  const radius = 0.08;
  const latBands = 10, lonBands = 10;
  const verts = [];
  const idxs = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = lat * Math.PI / latBands;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = lon * 2 * Math.PI / lonBands;
      verts.push(radius * sinT * Math.cos(phi), radius * cosT, radius * sinT * Math.sin(phi));
    }
  }
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const first = lat * (lonBands + 1) + lon;
      const second = first + lonBands + 1;
      idxs.push(first, second, first + 1);
      idxs.push(second, second + 1, first + 1);
    }
  }
  markerCount = idxs.length;

  markerVAO = gl.createVertexArray();
  gl.bindVertexArray(markerVAO);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idxs), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
}

function setupLineBuffer() {
  if (lineVAO) gl.deleteVertexArray(lineVAO);
  lineVAO = gl.createVertexArray();
  gl.bindVertexArray(lineVAO);

  lineVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVBO);
  gl.bufferData(gl.ARRAY_BUFFER, 2 * 3 * 4, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindVertexArray(null);
}

// ==================== ПЕРЕСТРОЙКА ====================
function rebuildAll() {
  buildMandrelGeometry();
  setupMandrelBuffers();
  computeGeodesicPath();
  currentLayerPoints = [];
  completedLayers = [];
  lastCarriageIdx = 0;
  currentDirection = 'forward';
  activePhaseOffset = 0;
  lastSavedLayerPhase = 0;
  animationTime = 0;
  lastFrameTime = performance.now();
  params.pause = true;
  layerCount = 0;
  document.getElementById('layerInfo').innerText = 'Слоёв: 0';
  if (tapeVBO) {
    gl.bindBuffer(gl.ARRAY_BUFFER, tapeVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(MAX_TRACE_POINTS * 2 * 3));
  }
}

function updateView(view) {
  manualCameraActive = false;
  switch (view) {
    case 'Спереди': cameraAzimuth = 0; cameraElevation = 0; break;
    case 'Сзади': cameraAzimuth = Math.PI; cameraElevation = 0; break;
    case 'Слева': cameraAzimuth = -Math.PI/2; cameraElevation = 0; break;
    case 'Справа': cameraAzimuth = Math.PI/2; cameraElevation = 0; break;
    case 'Сверху': cameraAzimuth = 0; cameraElevation = Math.PI/2 - 0.01; break;
    case 'Снизу': cameraAzimuth = 0; cameraElevation = -Math.PI/2 + 0.01; break;
    case 'Изометрия':
    default:
      cameraAzimuth = 0.7; cameraElevation = 0.5; break;
  }
  cameraDistance = 9.0;
  cameraTarget = [0, 0, 0];
}

// ==================== ОТРИСОВКА ====================
function drawScene(now) {
  if (!params.pause) {
    const delta = Math.min((now - lastFrameTime) * 0.001, 0.1);
    animationTime += delta;
  }
  lastFrameTime = now;

  omega = params.speed * 2.0 * Math.PI;

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const aspect = canvas.width / canvas.height;
  const projMatrix = glMatrix.mat4.perspective(glMatrix.mat4.create(), Math.PI / 3, aspect, 0.5, 50.0);

  const camPos = [
    cameraDistance * Math.sin(cameraAzimuth) * Math.cos(cameraElevation),
    cameraDistance * Math.sin(cameraElevation),
    cameraDistance * Math.cos(cameraAzimuth) * Math.cos(cameraElevation)
  ];
  const viewMatrix = glMatrix.mat4.lookAt(glMatrix.mat4.create(), camPos, cameraTarget, [0, 1, 0]);
  const vpMatrix = glMatrix.mat4.multiply(glMatrix.mat4.create(), projMatrix, viewMatrix);

  const mandrelAngle = -omega * animationTime;
  const modelMatrix = glMatrix.mat4.rotateZ(glMatrix.mat4.create(), glMatrix.mat4.create(), mandrelAngle);

  // ---- Оправка ----
  let mvp = glMatrix.mat4.multiply(glMatrix.mat4.create(), vpMatrix, modelMatrix);
  gl.uniformMatrix4fv(u_mvpMatrix, false, mvp);
  gl.uniform3f(u_color, 0.75, 0.75, 0.75);
  gl.bindVertexArray(mandrelVAO);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mandrelIBO);
  gl.drawElements(gl.TRIANGLES, mandrelIndices.length, gl.UNSIGNED_SHORT, 0);

  if (numPoints > 1 && omega > 0.001) {
    const T_forward = totalTheta / omega;
    const cycleTime = 2.0 * T_forward;
    const tCycle = animationTime % cycleTime;
    const cycleIndex = Math.floor(animationTime / cycleTime);
    const isForward = tCycle < T_forward;

    const currentPhaseOffset = cycleIndex * phiL;
    const phaseElapsed = isForward ? tCycle : (tCycle - T_forward);
    const progress = Math.min(phaseElapsed / T_forward, 1.0);

    // Проверка завершения слоя: фазовый сдвиг достиг кратного 2π
    const twoPi = 2 * Math.PI;
    const completedLayersCount = Math.floor(currentPhaseOffset / twoPi);
    // Сохраняем слой, если появился новый полный слой
    while (completedLayersCount > lastSavedLayerPhase / twoPi) {
      // Сохраняем текущий слой как завершённый
      if (currentLayerPoints.length > 0) {
        completedLayers.push(currentLayerPoints);
        currentLayerPoints = [];
        // Удаляем старые слои, если превышен лимит
        while (completedLayers.length > params.maxLayers) {
          completedLayers.shift();
        }
      }
      lastSavedLayerPhase += twoPi;
      layerCount++;
      document.getElementById('layerInfo').innerText = `Слоёв: ${layerCount}`;
    }

    const direction = isForward ? 'forward' : 'backward';
    const getLocalPoint = (idx) => isForward ? forwardWorld(idx, currentPhaseOffset) : backwardWorld(idx, currentPhaseOffset);

    // Обработка смены направления
    if (currentDirection !== direction) {
      if (currentLayerPoints.length > 0) {
        const oldGet = currentDirection === 'forward' ? forwardWorld : backwardWorld;
        const endIdx = numPoints - 1;
        const step = lastCarriageIdx < endIdx ? 1 : -1;
        for (let i = lastCarriageIdx + step; (step > 0 ? i <= endIdx : i >= endIdx); i += step) {
          if (i >= 0 && i < numPoints) {
            currentLayerPoints.push(oldGet(i, activePhaseOffset));
          }
        }
      }
      currentDirection = direction;
      activePhaseOffset = currentPhaseOffset;
      lastCarriageIdx = 0;
    }

    let currentIdx;
    if (isForward) {
      currentIdx = Math.floor(progress * (numPoints - 1));
    } else {
      currentIdx = Math.floor(progress * (numPoints - 1));
    }
    currentIdx = Math.min(Math.max(currentIdx, 0), numPoints - 1);

    // Добавление новых точек в текущий слой
    if (currentIdx !== lastCarriageIdx) {
      const step = currentIdx > lastCarriageIdx ? 1 : -1;
      for (let i = lastCarriageIdx + step; (step > 0 ? i <= currentIdx : i >= currentIdx); i += step) {
        if (i >= 0 && i < numPoints) {
          currentLayerPoints.push(getLocalPoint(i));
        }
      }
      lastCarriageIdx = currentIdx;
    }

    // Отрисовка ленты
    const allPoints = getAllPoints();
    if (allPoints.length >= 2) {
      updateTapeAndEdges();

      // Красная заливка
      gl.bindVertexArray(tapeVAO);
      mvp = glMatrix.mat4.multiply(glMatrix.mat4.create(), vpMatrix, modelMatrix);
      gl.uniformMatrix4fv(u_mvpMatrix, false, mvp);
      gl.uniform3f(u_color, 0.9, 0.2, 0.1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, allPoints.length * 2);

      // Чёрные кромки
      if (leftEdgeCount > 0) {
        gl.bindVertexArray(leftEdgeVAO);
        mvp = glMatrix.mat4.multiply(glMatrix.mat4.create(), vpMatrix, modelMatrix);
        gl.uniformMatrix4fv(u_mvpMatrix, false, mvp);
        gl.uniform3f(u_color, 0.0, 0.0, 0.0);
        gl.drawArrays(gl.LINE_STRIP, 0, leftEdgeCount);
      }
      if (rightEdgeCount > 0) {
        gl.bindVertexArray(rightEdgeVAO);
        mvp = glMatrix.mat4.multiply(glMatrix.mat4.create(), vpMatrix, modelMatrix);
        gl.uniformMatrix4fv(u_mvpMatrix, false, mvp);
        gl.uniform3f(u_color, 0.0, 0.0, 0.0);
        gl.drawArrays(gl.LINE_STRIP, 0, rightEdgeCount);
      }
    }

    // ---- Каретка + линия связи ----
    if (currentIdx >= 0 && currentIdx < numPoints) {
      const localTouch = getLocalPoint(currentIdx);
      const worldTouch = glMatrix.vec3.transformMat4(
        glMatrix.vec3.create(),
        glMatrix.vec3.fromValues(localTouch[0], localTouch[1], localTouch[2]),
        modelMatrix
      );

      const carriageX = params.R + CLEARANCE;
      const carriageY = 0.0;
      const carriageZ = localTouch[2];
      const carriagePos = [carriageX, carriageY, carriageZ];

      const lineVertices = new Float32Array([
        carriagePos[0], carriagePos[1], carriagePos[2],
        worldTouch[0], worldTouch[1], worldTouch[2]
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineVBO);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineVertices);
      gl.bindVertexArray(lineVAO);
      mvp = glMatrix.mat4.multiply(glMatrix.mat4.create(), vpMatrix, glMatrix.mat4.create());
      gl.uniformMatrix4fv(u_mvpMatrix, false, mvp);
      gl.uniform3f(u_color, 1.0, 0.5, 0.0);
      gl.drawArrays(gl.LINES, 0, 2);

      const markerModel = glMatrix.mat4.translate(glMatrix.mat4.create(), glMatrix.mat4.create(), carriagePos);
      mvp = glMatrix.mat4.multiply(glMatrix.mat4.create(), vpMatrix, markerModel);
      gl.uniformMatrix4fv(u_mvpMatrix, false, mvp);
      gl.uniform3f(u_color, 0.1, 0.4, 0.9);
      gl.bindVertexArray(markerVAO);
      gl.drawElements(gl.TRIANGLES, markerCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  requestAnimationFrame(drawScene);
}

// ==================== МЫШЬ ====================
function setupMouseControls() {
  canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    manualCameraActive = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  window.addEventListener('mousemove', (e) => {
    if (!mouseDown || !manualCameraActive) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    cameraAzimuth -= dx * 0.01;
    cameraElevation += dy * 0.01;
    cameraElevation = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, cameraElevation));
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    if (!manualCameraActive) return;
    cameraDistance *= Math.exp(-e.deltaY * 0.001);
    cameraDistance = Math.max(2, Math.min(30, cameraDistance));
    e.preventDefault();
  });
}

// ==================== GUI ====================
function setupGUI() {
  const gui = new dat.GUI();
  gui.add(params, 'R', 0.5, 3.0).name('Радиус R').onChange(rebuildAll);
  gui.add(params, 'L', 1.0, 8.0).name('Длина L').onChange(rebuildAll);
  gui.add(params, 'rn', 0.1, 1.5).name('r полюс.отв.').onChange(rebuildAll);
  gui.add(params, 'tapeWidth', 0.05, 0.5).name('Ширина ленты');
  gui.add(params, 'speed', 0.1, 10.0).name('Скорость (об/с)');
  gui.add(params, 'pause').name('Пауза');
  gui.add(params, 'maxLayers', 1, 10, 1).name('Макс. слоёв').onChange(() => {
    // Принудительно удалить старые слои при уменьшении лимита
    while (completedLayers.length > params.maxLayers) {
      completedLayers.shift();
    }
  });
  gui.add(params, 'renderMode', ['polygons', 'wireframe']).name('Режим');
  gui.add({ view: 'Изометрия' }, 'view', ['Спереди', 'Сзади', 'Слева', 'Справа', 'Сверху', 'Снизу', 'Изометрия']).name('Проекция').onChange(updateView);
  gui.add({ reset: rebuildAll }, 'reset').name('Сброс анимации');
}

// ==================== ЗАПУСК ====================
window.onload = async () => {
  if (!(await initWebGL())) return;
  rebuildAll();
  setupTapeBuffer();
  setupEdgeBuffers();
  buildMarkerGeometry();
  setupLineBuffer();
  setupMouseControls();
  setupGUI();

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  });

  requestAnimationFrame(drawScene);
};