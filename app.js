const svg = document.querySelector("#schematic");
const dropZone = document.querySelector("#dropZone");
const currentValue = document.querySelector("#currentValue");
const currentBar = document.querySelector("#currentBar");
const structureSummary = document.querySelector("#structureSummary");
const explainBox = document.querySelector("#explainBox");
const resetButton = document.querySelector("#resetButton");

const SVG_NS = "http://www.w3.org/2000/svg";
const LEAF_W = 132;
const LEAF_H = 122;
const SERIES_GAP = 30;
const SERIES_WRAP_WIDTH = 720;
const SERIES_ROW_GAP = 82;
const PARALLEL_GAP = 34;
const PARALLEL_SIDE = 66;
const BOARD_PAD = 70;
const WIRE_WIDTH = 8;
const BEND_CLEARANCE = 46;
const OUTER_RETURN_CLEARANCE = 44;
const EXAM_RAIL_SIDE = 66;
const EXAM_RAIL_GAP = 34;
const JUNCTION_R = 5;
const NEAR_ZERO_RESISTANCE = 0.000001;
const BASE_RESISTANCE = {
  bulb: 1,
  battery: NEAR_ZERO_RESISTANCE,
  ammeter: NEAR_ZERO_RESISTANCE,
  wire: NEAR_ZERO_RESISTANCE,
};
const BASE_EMF = {
  battery: 1,
  bulb: 0,
  ammeter: 0,
  wire: 0,
};
const SHORT_RESISTANCE_LIMIT = 0.01;
const LARGE_CURRENT_LIMIT = 20;
const KIND_LABEL = {
  battery: "電池",
  bulb: "豆電球",
  ammeter: "電流計",
  wire: "導線",
};
const SYMBOL_Y_OFFSET = 46;
const BADGE_Y_OFFSET = 94;
const LABEL_Y_OFFSET = 116;

const state = {
  tree: null,
  drag: null,
  renderItems: [],
  metrics: null,
};

const counters = {
  battery: 1,
  bulb: 1,
  ammeter: 1,
  wire: 1,
  group: 1,
};

const presets = {
  "fig398-1": () => series([leaf("battery"), leaf("bulb")]),
  "fig398-2": () => series([leaf("battery"), leaf("battery"), leaf("bulb"), leaf("bulb")]),
  "fig398-3": () => series([leaf("battery"), leaf("battery"), leaf("battery"), parallel([leaf("bulb"), leaf("bulb")])]),
  "fig398-4": () => series([parallel([leaf("battery"), leaf("battery")]), leaf("bulb"), leaf("bulb")]),
  "fig398-5": () => series([parallel([leaf("battery"), leaf("battery")]), parallel([leaf("bulb"), leaf("bulb")]), leaf("ammeter")]),
  fig400: () => series([parallel([leaf("bulb"), series([leaf("bulb"), leaf("bulb")])]), leaf("battery"), leaf("battery")]),
  "fig402-2": () => series([leaf("battery"), leaf("bulb"), parallel([leaf("wire"), leaf("bulb")])]),
  "fig402-4": () =>
    series([
      leaf("battery"),
      leaf("battery"),
      leaf("battery"),
      parallel([series([leaf("bulb"), leaf("bulb")]), leaf("bulb"), series([leaf("bulb"), leaf("bulb")])]),
    ]),
};

function leaf(kind) {
  counters[kind] += 1;
  return { type: "leaf", kind, id: `${kind}-${counters[kind] - 1}` };
}

function series(children) {
  counters.group += 1;
  return normalize({ type: "series", id: `group-${counters.group - 1}`, children });
}

function parallel(children) {
  counters.group += 1;
  return normalize({ type: "parallel", id: `group-${counters.group - 1}`, children });
}

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function normalize(node) {
  if (!node || node.type === "leaf") return node;
  const children = node.children.map(normalize).filter(Boolean);
  const flattened = [];
  for (const child of children) {
    if (child.type === node.type) {
      flattened.push(...child.children);
    } else {
      flattened.push(child);
    }
  }
  if (flattened.length === 0) return null;
  if (flattened.length === 1) return flattened[0];
  return { ...node, children: flattened };
}

function countLeaves(node) {
  if (!node) return 0;
  if (node.type === "leaf") return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

function findPathById(node, id, path = []) {
  if (!node) return null;
  if (node.id === id) return path;
  if (node.type === "leaf") return null;
  for (let i = 0; i < node.children.length; i += 1) {
    const found = findPathById(node.children[i], id, [...path, i]);
    if (found) return found;
  }
  return null;
}

function getNodeAtPath(node, path) {
  let current = node;
  for (const index of path) current = current.children[index];
  return current;
}

function replaceAtPath(node, path, replacement) {
  if (path.length === 0) return replacement;
  const next = cloneNode(node);
  let parent = next;
  for (let i = 0; i < path.length - 1; i += 1) parent = parent.children[path[i]];
  parent.children[path[path.length - 1]] = replacement;
  return next;
}

function removeAtPath(node, path) {
  if (path.length === 0) return null;
  const next = cloneNode(node);
  let parent = next;
  for (let i = 0; i < path.length - 1; i += 1) parent = parent.children[path[i]];
  parent.children.splice(path[path.length - 1], 1);
  return normalize(next);
}

function insertNode(root, targetId, nodeToInsert, mode) {
  if (!root) return nodeToInsert;
  const path = findPathById(root, targetId);
  if (!path) return root;
  const target = getNodeAtPath(root, path);
  const insertBefore = mode === "series-before" || mode === "parallel-before";
  const groupType = mode.startsWith("series") ? "series" : "parallel";

  if (path.length > 0) {
    const parentPath = path.slice(0, -1);
    const parent = getNodeAtPath(root, parentPath);
    if (parent.type === groupType) {
      const next = cloneNode(root);
      let nextParent = next;
      for (const index of parentPath) nextParent = nextParent.children[index];
      const targetIndex = path[path.length - 1];
      nextParent.children.splice(insertBefore ? targetIndex : targetIndex + 1, 0, nodeToInsert);
      return normalize(next);
    }
  }

  const children = insertBefore ? [nodeToInsert, target] : [target, nodeToInsert];
  const replacement = groupType === "series" ? series(children) : parallel(children);
  return normalize(replaceAtPath(root, path, replacement));
}

function isDescendantId(node, id) {
  if (!node) return false;
  if (node.id === id) return true;
  if (node.type === "leaf") return false;
  return node.children.some((child) => isDescendantId(child, id));
}

function evaluate(node) {
  if (!node) return { emf: 0, resistance: Infinity, shorted: false };
  if (node.type === "leaf") {
    return {
      emf: BASE_EMF[node.kind],
      resistance: BASE_RESISTANCE[node.kind],
      shorted: node.kind === "wire",
    };
  }

  const children = node.children.map(evaluate);
  if (node.type === "series") {
    return {
      emf: children.reduce((sum, child) => sum + child.emf, 0),
      resistance: children.reduce((sum, child) => sum + child.resistance, 0),
      shorted: false,
    };
  }

  const conductance = children.reduce((sum, child) => sum + 1 / child.resistance, 0);
  const emfWeighted = children.reduce((sum, child) => sum + child.emf / child.resistance, 0);
  const resistance = conductance > 0 ? 1 / conductance : Infinity;
  return {
    emf: conductance > 0 ? emfWeighted / conductance : 0,
    resistance,
    shorted: children.some((child) => child.resistance <= BASE_RESISTANCE.wire && child.emf === 0),
  };
}

function calculateCurrents(root) {
  const eq = evaluate(root);
  const map = new Map();
  const total = eq.resistance > 0 && Number.isFinite(eq.resistance) ? eq.emf / eq.resistance : 0;
  assignByCurrent(root, total, map);
  const safety = analyzeEducationalShorts(root, map, Math.abs(total));
  return { eq, total: Math.abs(total), map, ...safety };
}

function assignByCurrent(node, current, map) {
  if (!node) return;
  if (node.type === "leaf") {
    map.set(node.id, Math.abs(current));
    return;
  }
  if (node.type === "series") {
    node.children.forEach((child) => assignByCurrent(child, current, map));
    return;
  }

  const eq = evaluate(node);
  const terminalVoltage = eq.emf - current * eq.resistance;
  node.children.forEach((child) => {
    const childEq = evaluate(child);
    const branchCurrent = (childEq.emf - terminalVoltage) / childEq.resistance;
    assignByCurrent(child, branchCurrent, map);
  });
}

function fmt(value) {
  if (!Number.isFinite(value)) return "∞";
  if (Math.abs(value) < 0.005) return "0";
  return rationalFraction(Math.abs(value));
}

function displayCurrent(calc, nodeId) {
  if (calc.displayMap?.has(nodeId)) return calc.displayMap.get(nodeId);
  const value = calc.map.get(nodeId) || 0;
  if (value > LARGE_CURRENT_LIMIT) return "大";
  return fmt(value);
}

function displayTotal(calc) {
  if (calc.totalDisplay) return calc.totalDisplay;
  if (calc.total > LARGE_CURRENT_LIMIT) return "ショート";
  return fmt(calc.total);
}

function analyzeEducationalShorts(root, currentMap, total) {
  const displayMap = new Map();
  const warningSet = new Set();
  let sourceShort = false;

  function markLeaves(node, value, options = {}) {
    flattenLeaves(node).forEach((leafNode) => {
      if (options.onlyKinds && !options.onlyKinds.includes(leafNode.kind)) return;
      if (displayMap.get(leafNode.id) === "大" && value === "0") return;
      displayMap.set(leafNode.id, value);
    });
  }

  function walk(node) {
    if (!node || node.type === "leaf") return;

    if (node.type === "parallel") {
      const branchInfo = node.children.map((child) => {
        const eq = evaluate(child);
        const leaves = flattenLeaves(child);
        return {
          child,
          eq,
          leaves,
          isLowResistance: eq.emf === 0 && eq.resistance <= SHORT_RESISTANCE_LIMIT,
          hasBattery: leaves.some((leafNode) => leafNode.kind === "battery"),
        };
      });
      const lowBranches = branchInfo.filter((branch) => branch.isLowResistance);
      const hasBatteryBranch = branchInfo.some((branch) => branch.hasBattery);
      const hasNonBatteryBranch = branchInfo.some((branch) => !branch.hasBattery);

      if (hasBatteryBranch && hasNonBatteryBranch) {
        sourceShort = true;
        warningSet.add("電池が豆電球・導線・電流計などと並列になっています。中学受験の通常の明るさ比べでは扱わないつなぎ方です。");
      }

      if (lowBranches.length && branchInfo.length > lowBranches.length) {
        const nonLowBranches = branchInfo.filter((branch) => !branch.isLowResistance);
        const shortsBattery = nonLowBranches.some((branch) => branch.hasBattery);
        const bypassesLoad = nonLowBranches.some((branch) => !branch.hasBattery && branch.leaves.some((leafNode) => leafNode.kind === "bulb"));

        lowBranches.forEach((branch) => {
          branch.leaves.forEach((leafNode) => {
            const current = currentMap.get(leafNode.id) || 0;
            displayMap.set(leafNode.id, current > LARGE_CURRENT_LIMIT || shortsBattery ? "大" : fmt(current));
          });
        });

        if (shortsBattery) {
          sourceShort = true;
          nonLowBranches.forEach((branch) => {
            markLeaves(branch.child, "大", { onlyKinds: ["battery", "wire", "ammeter"] });
          });
          warningSet.add("電池が導線または電流計でショートしています。通常の明るさ比べではなく、危険なつなぎ方として扱います。");
        } else if (bypassesLoad) {
          nonLowBranches.forEach((branch) => markLeaves(branch.child, "0", { onlyKinds: ["bulb"] }));
          warningSet.add("導線または電流計だけの枝でショートしています。並列の豆電球にはほとんど電流が流れません。");
        }
      }
    }

    node.children.forEach(walk);
  }

  walk(root);

  if (sourceShort) {
    flattenLeaves(root).forEach((leafNode) => {
      if (["battery", "wire", "ammeter"].includes(leafNode.kind)) {
        displayMap.set(leafNode.id, "大");
      } else if (!displayMap.has(leafNode.id)) {
        displayMap.set(leafNode.id, "0");
      }
    });
  }

  return {
    displayMap,
    totalDisplay: sourceShort || total > LARGE_CURRENT_LIMIT ? "ショート" : null,
    warnings: [...warningSet],
  };
}

function rationalFraction(value) {
  const denominators = Array.from({ length: 32 }, (_, index) => index + 1);
  let best = null;
  denominators.forEach((denominator) => {
    const numerator = Math.max(0, Math.round(value * denominator));
    const approx = numerator / denominator;
    const error = Math.abs(approx - value);
    const divisor = gcd(numerator, denominator);
    const reducedDenominator = denominator / divisor;
    const score = error + reducedDenominator * 0.0002;
    if (!best || score < best.score) best = { numerator, denominator, score };
  });
  const divisor = gcd(best.numerator, best.denominator);
  const numerator = best.numerator / divisor;
  const denominator = best.denominator / divisor;
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function makeEl(name, attrs = {}, text = "") {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (text) el.textContent = text;
  return el;
}

function measure(node) {
  const examPlan = getExamRailPlan(node);
  if (examPlan) {
    const branchSizes = examPlan.branches.map((branch) => measure(branch));
    return {
      w: Math.max(...branchSizes.map((size) => size.w)) + EXAM_RAIL_SIDE * 2,
      h: branchSizes.reduce((sum, size) => sum + size.h, 0) + EXAM_RAIL_GAP * (branchSizes.length - 1),
    };
  }

  if (node.type === "leaf") return { w: LEAF_W, h: LEAF_H };
  const sizes = node.children.map(measure);
  if (node.type === "series") {
    const rows = buildSeriesRows(sizes);
    return {
      w: Math.max(...rows.map((row) => row.w)),
      h: rows.reduce((sum, row) => sum + row.h, 0) + SERIES_ROW_GAP * (rows.length - 1),
    };
  }
  return {
    w: Math.max(...sizes.map((size) => size.w)) + PARALLEL_SIDE * 2,
    h: sizes.reduce((sum, size) => sum + size.h, 0) + PARALLEL_GAP * (sizes.length - 1),
  };
}

function getExamRailPlan(node) {
  if (!node || node.type !== "series") return null;
  const runs = [];
  node.children.forEach((child) => {
    const kind = getExamBlockKind(child);
    if (!kind) return;
    const last = runs.at(-1);
    if (last?.kind === kind) {
      last.nodes.push(child);
    } else {
      runs.push({ kind, nodes: [child] });
    }
  });
  if (runs.reduce((sum, run) => sum + run.nodes.length, 0) !== node.children.length) return null;
  if (runs.length !== 2 || !runs.some((run) => run.kind === "source") || !runs.some((run) => run.kind === "load")) return null;
  if (!runs.every(isExamRunSupported)) return null;

  const loadRun = runs.find((run) => run.kind === "load");
  const sourceRun = runs.find((run) => run.kind === "source");
  return {
    loadRun,
    sourceRun,
    branches: [...expandExamRun(loadRun), ...expandExamRun(sourceRun)],
  };
}

function isExamRunSupported(run) {
  return run.nodes.length === 1 || run.nodes.every((node) => node.type !== "parallel");
}

function getExamBlockKind(node) {
  const leaves = flattenLeaves(node);
  if (!leaves.length) return null;
  if (leaves.every((leafNode) => leafNode.kind === "battery")) return "source";
  if (leaves.every((leafNode) => leafNode.kind !== "battery")) return "load";
  return null;
}

function expandExamRun(run) {
  const block = makeExamRunBlock(run);
  return block.type === "parallel" ? block.children : [block];
}

function makeExamRunBlock(run) {
  if (run.nodes.length === 1) return run.nodes[0];
  return {
    type: "series",
    id: `${run.kind}-exam-${run.nodes.map((node) => node.id).join("-")}`,
    children: run.nodes,
    virtual: true,
  };
}

function buildSeriesRows(sizes) {
  const rows = [];
  let current = { start: 0, end: 0, w: 0, h: 0, sizes: [] };

  sizes.forEach((size, index) => {
    const nextW = current.sizes.length ? current.w + SERIES_GAP + size.w : size.w;
    if (current.sizes.length && nextW > SERIES_WRAP_WIDTH) {
      rows.push(current);
      current = { start: index, end: index, w: size.w, h: size.h, sizes: [size] };
      return;
    }
    current.end = index;
    current.w = nextW;
    current.h = Math.max(current.h, size.h);
    current.sizes.push(size);
  });

  if (current.sizes.length) rows.push(current);
  return rows;
}

function layoutNode(node, x, y, options = {}) {
  const examPlan = getExamRailPlan(node);
  if (examPlan) return layoutExamRail(node, examPlan, x, y, options);

  const size = measure(node);
  if (node.type === "leaf") {
    const entryX = options.reverse ? x + size.w - 6 : x + 6;
    const exitX = options.reverse ? x + 6 : x + size.w - 6;
    return {
      ...size,
      x,
      y,
      node,
      entry: { x: entryX, y: y + size.h / 2 },
      exit: { x: exitX, y: y + size.h / 2 },
      children: [],
      reverse: Boolean(options.reverse),
    };
  }

  if (node.type === "series") {
    const childSizes = node.children.map(measure);
    const rows = buildSeriesRows(childSizes);
    const children = [];
    const rowY = getSeriesRowY(rows, y, size.h);
    const startsReversed = Boolean(options.reverse);
    rows.forEach((row, rowNumber) => {
      const reverseRow = startsReversed ? rowNumber % 2 === 0 : rowNumber % 2 === 1;
      let cx = reverseRow ? x + (size.w + row.w) / 2 : x + (size.w - row.w) / 2;
      row.sizes.forEach((childSize, rowIndex) => {
        const childIndex = row.start + rowIndex;
        if (reverseRow) cx -= childSize.w;
        const childLayout = layoutNode(node.children[childIndex], cx, rowY[rowNumber] + (row.h - childSize.h) / 2, { reverse: reverseRow });
        children[childIndex] = childLayout;
        cx += reverseRow ? -SERIES_GAP : childSize.w + SERIES_GAP;
      });
    });
    return {
      ...size,
      x,
      y,
      node,
      entry: children[0].entry,
      exit: children.at(-1).exit,
      children,
      reverse: startsReversed,
      rows: rows.map((row, index) => ({ ...row, y: rowY[index] })),
    };
  }

  const reverse = Boolean(options.reverse);
  let cy = y;
  const children = node.children.map((child) => {
    const childSize = measure(child);
    const childLayout = layoutNode(child, x + PARALLEL_SIDE + (size.w - PARALLEL_SIDE * 2 - childSize.w) / 2, cy, { reverse });
    cy += childSize.h + PARALLEL_GAP;
    return childLayout;
  });
  return {
    ...size,
    x,
    y,
    node,
    entry: { x: reverse ? x + size.w - 8 : x + 8, y: y + size.h / 2 },
    exit: { x: reverse ? x + 8 : x + size.w - 8, y: y + size.h / 2 },
    children,
    reverse,
  };
}

function layoutExamRail(node, plan, x, y, options = {}) {
  const branchSizes = plan.branches.map(measure);
  const size = measure(node);
  const reverse = Boolean(options.reverse);
  const leftX = reverse ? x + size.w - 8 : x + 8;
  const rightX = reverse ? x + 8 : x + size.w - 8;
  let cy = y;
  const children = plan.branches.map((branch, index) => {
    const branchSize = branchSizes[index];
    const bx = x + EXAM_RAIL_SIDE + (size.w - EXAM_RAIL_SIDE * 2 - branchSize.w) / 2;
    const childLayout = layoutNode(branch, bx, cy, { reverse });
    cy += branchSize.h + EXAM_RAIL_GAP;
    return childLayout;
  });
  const loadCount = expandExamRun(plan.loadRun).length;
  const examGroupItems = [
    makeExamGroupItem(plan.loadRun, children.slice(0, loadCount)),
    makeExamGroupItem(plan.sourceRun, children.slice(loadCount)),
  ].filter(Boolean);
  return {
    ...size,
    x,
    y,
    node,
    entry: { x: leftX, y: children[0].entry.y },
    exit: { x: rightX, y: children.at(-1).entry.y },
    children,
    reverse,
    examRail: true,
    examGroupItems,
  };
}

function makeExamGroupItem(run, layouts) {
  if (run.nodes.length !== 1 || run.nodes[0].type === "leaf") return null;
  const minX = Math.min(...layouts.map((layout) => layout.x));
  const minY = Math.min(...layouts.map((layout) => layout.y));
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.w));
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.h));
  return {
    node: run.nodes[0],
    bbox: {
      x: minX - 16,
      y: minY - 16,
      w: maxX - minX + 32,
      h: maxY - minY + 32,
    },
  };
}

function getSeriesRowY(rows, y, totalHeight) {
  if (rows.length <= 2) {
    let cy = y;
    return rows.map((row) => {
      const rowY = cy;
      cy += row.h + SERIES_ROW_GAP;
      return rowY;
    });
  }

  const positions = [];
  positions[0] = y;
  positions[1] = y + totalHeight - rows[1].h;
  let cy = y + rows[0].h + SERIES_ROW_GAP;
  for (let index = 2; index < rows.length; index += 1) {
    positions[index] = cy;
    cy += rows[index].h + SERIES_ROW_GAP;
  }
  return positions;
}

function drawWire(points, className = "wire") {
  const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  svg.append(makeEl("path", { class: className, d, fill: "none" }));
}

function drawJunctionDot(x, y) {
  svg.append(makeEl("circle", { class: "junction-dot", cx: x, cy: y, r: JUNCTION_R }));
}

function drawSeriesWire(fromLayout, toLayout) {
  const from = fromLayout.exit;
  const to = toLayout.entry;
  if (Math.abs(from.y - to.y) < 2) {
    drawWire([from, to]);
    return;
  }
  if (toLayout.reverse) {
    const bendX = Math.max(from.x, to.x) + BEND_CLEARANCE;
    drawWire([
      from,
      { x: bendX, y: from.y },
      { x: bendX, y: to.y },
      to,
    ]);
    return;
  }
  if (fromLayout.reverse) {
    const bendX = Math.min(from.x, to.x) - BEND_CLEARANCE;
    drawWire([
      from,
      { x: bendX, y: from.y },
      { x: bendX, y: to.y },
      to,
    ]);
    return;
  }
  const midY = (from.y + to.y) / 2;
  drawWire([
    from,
    { x: from.x + BEND_CLEARANCE, y: from.y },
    { x: from.x + BEND_CLEARANCE, y: midY },
    { x: to.x - BEND_CLEARANCE, y: midY },
    { x: to.x - BEND_CLEARANCE, y: to.y },
    to,
  ]);
}

function drawBadge(x, y, text, className = "current-badge") {
  const g = makeEl("g", { class: className });
  g.append(makeEl("rect", { x: x - 26, y: y - 15, width: 52, height: 26, rx: 6 }));
  g.append(makeEl("text", { class: "svg-small", x, y: y + 4, "text-anchor": "middle" }, text));
  svg.append(g);
}

function drawLeaf(layout, currents) {
  const { node, x, y, w, h } = layout;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const symbolY = y + SYMBOL_Y_OFFSET;
  const g = makeEl("g", { class: "drag-item", "data-id": node.id, tabindex: "0" });
  g.append(makeEl("rect", {
    class: "drag-hitbox",
    x: x + 10,
    y: y + 6,
    width: w - 20,
    height: h - 12,
    rx: 12,
  }));
  const sensor = makeEl("rect", {
    class: "drop-sensor",
    x: x + 2,
    y: y + 2,
    width: w - 4,
    height: h - 4,
    rx: 10,
    "data-id": node.id,
  });
  svg.append(sensor);

  if (node.kind === "bulb") {
    g.append(makeEl("circle", { class: "bulb-glass", cx, cy: symbolY, r: 25 }));
    g.append(makeEl("path", { class: "filament", d: `M ${cx - 15} ${symbolY} L ${cx - 5} ${symbolY - 10} L ${cx + 5} ${symbolY + 10} L ${cx + 15} ${symbolY}`, fill: "none" }));
    g.append(makeEl("text", { class: "svg-label", x: cx, y: y + LABEL_Y_OFFSET, "text-anchor": "middle" }, node.id.replace("bulb-", "豆")));
  } else if (node.kind === "battery") {
    g.append(makeEl("line", { class: "battery-long", x1: cx - 16, y1: symbolY - 30, x2: cx - 16, y2: symbolY + 30 }));
    g.append(makeEl("line", { class: "battery-short", x1: cx + 14, y1: symbolY - 21, x2: cx + 14, y2: symbolY + 21 }));
    g.append(makeEl("text", { class: "terminal-label", x: cx - 42, y: symbolY - 24, "text-anchor": "middle" }, "+"));
    g.append(makeEl("text", { class: "svg-label", x: cx, y: y + LABEL_Y_OFFSET, "text-anchor": "middle" }, node.id.replace("battery-", "電")));
  } else if (node.kind === "ammeter") {
    g.append(makeEl("circle", { class: "ammeter-face", cx, cy: symbolY, r: 27 }));
    g.append(makeEl("text", { class: "svg-label", x: cx, y: symbolY + 6, "text-anchor": "middle" }, "A"));
    g.append(makeEl("text", { class: "svg-label", x: cx, y: y + LABEL_Y_OFFSET, "text-anchor": "middle" }, node.id.replace("ammeter-", "計")));
  } else {
    g.append(makeEl("line", { class: "wire-leaf", x1: x + 28, y1: cy, x2: x + w - 28, y2: cy }));
    g.append(makeEl("text", { class: "svg-label", x: cx, y: y + LABEL_Y_OFFSET, "text-anchor": "middle" }, node.id.replace("wire-", "線")));
  }

  svg.append(g);
  drawBadge(cx, y + BADGE_Y_OFFSET, `I=${displayCurrent(state.metrics, node.id)}`);
  state.renderItems.push({
    id: node.id,
    node,
    bbox: { x, y, w, h },
    entry: layout.entry,
    exit: layout.exit,
  });
}

function drawLayout(layout, currents) {
  if (layout.node.type === "leaf") {
    const startTerminalX = layout.reverse ? layout.x + layout.w - 24 : layout.x + 24;
    const endTerminalX = layout.reverse ? layout.x + 24 : layout.x + layout.w - 24;
    drawWire([layout.entry, { x: startTerminalX, y: layout.entry.y }]);
    drawWire([{ x: endTerminalX, y: layout.exit.y }, layout.exit]);
    drawLeaf(layout, currents);
    return;
  }

  if (layout.examRail) {
    const leftX = layout.entry.x;
    const rightX = layout.exit.x;
    const firstY = layout.children[0].entry.y;
    const lastY = layout.children.at(-1).entry.y;
    drawWire([{ x: leftX, y: firstY }, { x: leftX, y: lastY }]);
    drawWire([{ x: rightX, y: firstY }, { x: rightX, y: lastY }]);
    layout.children.forEach((child) => {
      drawWire([{ x: leftX, y: child.entry.y }, child.entry]);
      drawWire([child.exit, { x: rightX, y: child.exit.y }]);
      drawLayout(child, currents);
      drawJunctionDot(leftX, child.entry.y);
      drawJunctionDot(rightX, child.exit.y);
    });
    layout.examGroupItems?.forEach((item) => {
      svg.append(makeEl("rect", {
        class: "drop-sensor",
        x: item.bbox.x,
        y: item.bbox.y,
        width: item.bbox.w,
        height: item.bbox.h,
        rx: 12,
        "data-id": item.node.id,
      }));
      state.renderItems.push({
        id: item.node.id,
        node: item.node,
        bbox: item.bbox,
        entry: layout.entry,
        exit: layout.exit,
      });
    });
  } else if (layout.node.type === "series") {
    layout.children.forEach((child, index) => {
      drawLayout(child, currents);
      if (index < layout.children.length - 1) drawSeriesWire(child, layout.children[index + 1]);
    });
  } else {
    const leftX = layout.entry.x;
    const rightX = layout.exit.x;
    const firstY = layout.children[0].entry.y;
    const lastY = layout.children.at(-1).entry.y;
    drawWire([{ x: leftX, y: firstY }, { x: leftX, y: lastY }]);
    drawWire([{ x: rightX, y: layout.children[0].exit.y }, { x: rightX, y: layout.children.at(-1).exit.y }]);
    layout.children.forEach((child) => {
      drawWire([{ x: leftX, y: child.entry.y }, child.entry]);
      drawWire([child.exit, { x: rightX, y: child.exit.y }]);
      drawLayout(child, currents);
    });
  }

  if (!layout.node.virtual) {
    svg.append(makeEl("rect", {
      class: "drop-sensor",
      x: layout.x,
      y: layout.y,
      width: layout.w,
      height: layout.h,
      rx: 12,
      "data-id": layout.node.id,
    }));
    state.renderItems.push({
      id: layout.node.id,
      node: layout.node,
      bbox: { x: layout.x, y: layout.y, w: layout.w, h: layout.h },
      entry: layout.entry,
      exit: layout.exit,
    });
  }
}

function render() {
  svg.replaceChildren();
  state.renderItems = [];
  if (!state.tree) {
    svg.setAttribute("viewBox", "0 0 980 560");
    svg.append(makeEl("text", { class: "svg-label", x: 490, y: 260, "text-anchor": "middle" }, "左の部品をドラッグして回路を作ります"));
    updateReadout({ total: 0, eq: { emf: 0, resistance: 0, shorted: false }, map: new Map() });
    return;
  }

  const calc = calculateCurrents(state.tree);
  state.metrics = calc;
  const size = measure(state.tree);
  const width = Math.max(980, size.w + BOARD_PAD * 2);
  const height = Math.max(560, size.h + BOARD_PAD * 2 + 120);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.setProperty("--schematic-width", `${width}px`);

  const layout = layoutNode(state.tree, BOARD_PAD, BOARD_PAD);
  if (!layout.examRail) drawOuterReturnWire(layout, width, size);
  drawLayout(layout, calc.map);
  drawTrashGuide(width, height);
  updateReadout(calc);
}

function drawOuterReturnWire(layout, width, size) {
  const rows = layout.node.type === "series" ? layout.rows || [] : [];
  const closesOnLeft = rows.length > 1 && layout.exit.x < layout.x + layout.w / 2;
  const leftReturnX = Math.max(24, layout.x - OUTER_RETURN_CLEARANCE);
  const rightReturnX = Math.min(width - 24, layout.x + layout.w + OUTER_RETURN_CLEARANCE);
  if (closesOnLeft) {
    drawWire([
      layout.exit,
      { x: leftReturnX, y: layout.exit.y },
      { x: leftReturnX, y: layout.entry.y },
      layout.entry,
    ]);
    return;
  }

  const bottomY = rows.length > 1 ? rows[1].y + rows[1].h / 2 : BOARD_PAD + size.h + 86;
  drawWire([
    { x: layout.exit.x, y: layout.exit.y },
    { x: rightReturnX, y: layout.exit.y },
    { x: rightReturnX, y: bottomY },
    { x: leftReturnX, y: bottomY },
    { x: leftReturnX, y: layout.entry.y },
    layout.entry,
  ]);
}

function drawTrashGuide(width, height) {
  if (!state.drag) return;
  const safe = safeRect(width, height);
  if (!state.drag.deletePreview) return;
  svg.append(makeEl("rect", {
    class: "delete-zone active",
    x: 12,
    y: 12,
    width: width - 24,
    height: height - 24,
    rx: 16,
  }));
  svg.append(makeEl("rect", {
    x: safe.x,
    y: safe.y,
    width: safe.w,
    height: safe.h,
    fill: "rgba(255,255,255,0.72)",
    stroke: "rgba(47,111,237,0.28)",
    "stroke-width": 2,
    "stroke-dasharray": "8 6",
    rx: 14,
  }));
  svg.append(makeEl("text", { class: "svg-warning", x: width - 160, y: 42, "text-anchor": "middle" }, "離すと削除"));
}

function updateReadout(calc) {
  currentValue.textContent = displayTotal(calc);
  currentBar.style.width = displayTotal(calc) === "ショート" ? "100%" : `${Math.min(100, Math.abs(calc.total) * 28)}%`;
  const leaves = flattenLeaves(state.tree);
  const batteries = leaves.filter((item) => item.kind === "battery").length;
  const bulbs = leaves.filter((item) => item.kind === "bulb").length;
  const ammeters = leaves.filter((item) => item.kind === "ammeter").length;
  const wires = leaves.filter((item) => item.kind === "wire").length;
  const rows = [
    ["部品", `電池 ${batteries}、豆電球 ${bulbs}、電流計 ${ammeters}、導線 ${wires}`],
    ["全体の電流", `I=${displayTotal(calc)}`],
    ["枝の状態", describeTree(state.tree)],
  ];
  structureSummary.innerHTML = rows
    .map(([label, value]) => `<div class="detail-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  const notes = [];
  if (!state.tree) {
    notes.push("部品を回路へドラッグしてください。");
  } else {
    notes.push("<strong>横に近づけると直列、縦に近づけると並列</strong>として追加します。");
    notes.push("表示される数字は、電池1個と豆電球1個の回路を I=1 としたときの電流です。");
    calc.warnings?.forEach((warning) => notes.push(`<strong>${warning}</strong>`));
  }
  explainBox.innerHTML = notes.join("<br />");
}

function flattenLeaves(node) {
  if (!node) return [];
  if (node.type === "leaf") return [node];
  return node.children.flatMap(flattenLeaves);
}

function describeTree(node) {
  if (!node) return "未配置";
  if (node.type === "leaf") return KIND_LABEL[node.kind];
  const sep = node.type === "series" ? " - " : " / ";
  const open = node.type === "series" ? "直列(" : "並列(";
  return `${open}${node.children.map(describeTree).join(sep)})`;
}

function svgPoint(event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function distanceToBox(point, box) {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  return Math.hypot(dx, dy);
}

function findDrop(point) {
  if (!state.tree) return null;
  const sourceNode = state.drag?.sourceNode;
  const seriesEdge = findSeriesEdgeDrop(point, sourceNode);
  if (seriesEdge) return seriesEdge;
  const candidates = state.renderItems
    .filter((item) => !sourceNode || !isDescendantId(sourceNode, item.id))
    .map((item) => getAttachmentDrop(item, point))
    .filter(Boolean)
    .sort((a, b) => {
      const leafBias = (b.item.node.type === "leaf" ? 1 : 0) - (a.item.node.type === "leaf" ? 1 : 0);
      return a.score - b.score || leafBias;
    });
  return candidates[0] ? { target: candidates[0].item, mode: candidates[0].mode } : null;
}

function getAttachmentDrop(item, point) {
  const box = item.bbox;
  const reach = item.node.type === "leaf" ? 96 : 120;
  const edgeInset = 28;
  const crossSlack = item.node.type === "leaf" ? 42 : 72;
  const candidates = [];

  const left = point.x >= box.x - reach && point.x <= box.x + edgeInset && point.y >= box.y - crossSlack && point.y <= box.y + box.h + crossSlack;
  const right = point.x >= box.x + box.w - edgeInset && point.x <= box.x + box.w + reach && point.y >= box.y - crossSlack && point.y <= box.y + box.h + crossSlack;
  const top = point.y >= box.y - reach && point.y <= box.y + edgeInset && point.x >= box.x - crossSlack && point.x <= box.x + box.w + crossSlack;
  const bottom = point.y >= box.y + box.h - edgeInset && point.y <= box.y + box.h + reach && point.x >= box.x - crossSlack && point.x <= box.x + box.w + crossSlack;

  if (left) candidates.push({ item, mode: "series-before", score: Math.abs(point.x - box.x) });
  if (right) candidates.push({ item, mode: "series-after", score: Math.abs(point.x - (box.x + box.w)) });
  if (top) candidates.push({ item, mode: "parallel-before", score: Math.abs(point.y - box.y) });
  if (bottom) candidates.push({ item, mode: "parallel-after", score: Math.abs(point.y - (box.y + box.h)) });

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || null;
}

function findSeriesEdgeDrop(point, sourceNode) {
  const edgeCandidates = state.renderItems
    .filter((item) => item.node.type === "series")
    .filter((item) => !sourceNode || !isDescendantId(sourceNode, item.id))
    .map((item) => {
      const box = item.bbox;
      const rightDistance = Math.abs(point.x - (box.x + box.w));
      const leftDistance = Math.abs(point.x - box.x);
      const insideY = point.y >= box.y - 90 && point.y <= box.y + box.h + 90;
      const after = point.x >= box.x + box.w - 36 && point.x <= box.x + box.w + 160 && insideY;
      const before = point.x >= box.x - 160 && point.x <= box.x + 36 && insideY;
      if (!after && !before) return null;
      return {
        target: item,
        mode: after ? "series-after" : "series-before",
        score: after ? rightDistance : leftDistance,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);
  return edgeCandidates[0] || null;
}

function showDropPreview(drop) {
  svg.querySelectorAll(".drop-sensor.active").forEach((el) => el.classList.remove("active"));
  svg.querySelectorAll(".drop-preview").forEach((el) => el.remove());
  if (!drop) return;
  const el = svg.querySelector(`.drop-sensor[data-id="${drop.target.id}"]`);
  if (el) el.classList.add("active");
  drawDropPreview(drop);
}

function drawDropPreview(drop) {
  const box = drop.target.bbox;
  const isSeries = drop.mode.startsWith("series");
  const before = drop.mode.endsWith("before");
  const gap = 18;
  const preview = {
    w: LEAF_W,
    h: LEAF_H,
    x: box.x + box.w / 2 - LEAF_W / 2,
    y: box.y + box.h / 2 - LEAF_H / 2,
  };

  if (isSeries) {
    preview.x = before ? box.x - LEAF_W - gap : box.x + box.w + gap;
  } else {
    preview.y = before ? box.y - LEAF_H - gap : box.y + box.h + gap;
  }

  const group = makeEl("g", { class: `drop-preview ${isSeries ? "series" : "parallel"}` });
  group.append(makeEl("rect", {
    class: "drop-preview-box",
    x: preview.x,
    y: preview.y,
    width: preview.w,
    height: preview.h,
    rx: 10,
  }));

  const lineStart = isSeries
    ? { x: before ? preview.x + preview.w : box.x + box.w, y: box.y + box.h / 2 }
    : { x: box.x + box.w / 2, y: before ? preview.y + preview.h : box.y + box.h };
  const lineEnd = isSeries
    ? { x: before ? box.x : preview.x, y: box.y + box.h / 2 }
    : { x: box.x + box.w / 2, y: before ? box.y : preview.y };
  const d = `M ${lineStart.x} ${lineStart.y} L ${lineEnd.x} ${lineEnd.y}`;
  group.append(makeEl("path", { class: "drop-preview-line", d, fill: "none" }));

  const label = isSeries ? "直列" : "並列";
  const labelX = isSeries ? preview.x + preview.w / 2 : box.x + box.w / 2 + preview.w / 2 + 12;
  const labelY = isSeries ? preview.y - 12 : preview.y + preview.h / 2 + 5;
  group.append(makeEl("rect", {
    class: "drop-preview-label-bg",
    x: labelX - 31,
    y: labelY - 20,
    width: 62,
    height: 28,
    rx: 7,
  }));
  group.append(makeEl("text", { class: "drop-preview-label", x: labelX, y: labelY, "text-anchor": "middle" }, label));
  svg.append(group);
}

function safeRect(width, height) {
  return {
    x: Math.max(44, width * 0.08),
    y: Math.max(44, height * 0.08),
    w: Math.max(260, width * 0.84),
    h: Math.max(260, height * 0.84),
  };
}

function isOutsideSafeArea(point) {
  const viewBox = svg.viewBox.baseVal;
  const safe = safeRect(viewBox.width, viewBox.height);
  return point.x < safe.x || point.y < safe.y || point.x > safe.x + safe.w || point.y > safe.y + safe.h;
}

function beginDrag(event, payload) {
  event.preventDefault();
  const start = svgPoint(event);
  state.drag = {
    ...payload,
    pointerId: event.pointerId,
    start,
    current: start,
    drop: null,
    deletePreview: false,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp, { once: true });
  render();
}

function onPointerMove(event) {
  if (!state.drag) return;
  const point = svgPoint(event);
  state.drag.current = point;
  const moved = Math.hypot(point.x - state.drag.start.x, point.y - state.drag.start.y);
  const drop = findDrop(point);
  state.drag.drop = drop;
  state.drag.deletePreview = state.drag.fromExisting && moved > 80 && !drop && isOutsideSafeArea(point);
  render();
  showDropPreview(state.drag.deletePreview ? null : drop);
  drawDragGhost(point);
}

function onPointerUp(event) {
  if (!state.drag) return;
  const point = svgPoint(event);
  const drag = state.drag;
  const drop = drag.drop || findDrop(point);
  let nextTree = state.tree;

  if (drag.fromExisting && drag.deletePreview) {
    const path = findPathById(nextTree, drag.sourceNode.id);
    if (path) nextTree = removeAtPath(nextTree, path);
  } else if (drop || !nextTree) {
    let nodeToInsert = drag.fromExisting ? drag.sourceNode : leaf(drag.kind);
    if (drag.fromExisting) {
      const sourcePath = findPathById(nextTree, drag.sourceNode.id);
      if (sourcePath) nextTree = removeAtPath(nextTree, sourcePath);
      if (drop && isDescendantId(drag.sourceNode, drop.target.id)) {
        state.drag = null;
        render();
        cleanupPointer();
        return;
      }
    }
    nextTree = drop ? insertNode(nextTree, drop.target.id, nodeToInsert, drop.mode) : nodeToInsert;
  }

  state.tree = normalize(nextTree);
  state.drag = null;
  cleanupPointer();
  render();
}

function cleanupPointer() {
  document.removeEventListener("pointermove", onPointerMove);
}

function drawDragGhost(point) {
  if (!state.drag) return;
  const kind = state.drag.kind || state.drag.sourceNode.kind || "bulb";
  const ghost = makeEl("g", { class: `drag-ghost${state.drag.deletePreview ? " delete" : ""}` });
  const node = { type: "leaf", kind, id: "ghost" };
  const layout = { node, x: point.x - LEAF_W / 2, y: point.y - LEAF_H / 2, w: LEAF_W, h: LEAF_H, entry: point, exit: point };
  svg.append(ghost);
  const oldAppend = svg.append.bind(svg);
  svg.append = (child) => ghost.append(child);
  drawLeaf(layout, new Map([["ghost", 0]]));
  svg.append = oldAppend;
  svg.append(ghost);
}

function installEvents() {
  document.querySelectorAll(".part").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      beginDrag(event, { fromExisting: false, kind: button.dataset.part });
    });
  });

  svg.addEventListener("pointerdown", (event) => {
    const item = event.target.closest?.(".drag-item");
    if (!item) return;
    const node = getNodeById(state.tree, item.dataset.id);
    if (!node || node.type !== "leaf") return;
    beginDrag(event, { fromExisting: true, sourceNode: cloneNode(node), kind: node.kind });
  });

  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (countLeaves(state.tree) > 2 && !window.confirm("現在の回路を消してテンプレートを読み込みます。よろしいですか？")) return;
      resetCounters();
      state.tree = presets[button.dataset.preset]();
      render();
    });
  });

  resetButton.addEventListener("click", () => {
    if (countLeaves(state.tree) > 0 && !window.confirm("現在の回路をリセットします。よろしいですか？")) return;
    resetCounters();
    state.tree = presets["fig398-1"]();
    render();
  });
}

function getNodeById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  if (node.type === "leaf") return null;
  for (const child of node.children) {
    const found = getNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function resetCounters() {
  counters.battery = 1;
  counters.bulb = 1;
  counters.ammeter = 1;
  counters.wire = 1;
  counters.group = 1;
}

resetCounters();
state.tree = presets["fig398-1"]();
installEvents();
render();
