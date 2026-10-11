/**
 * 2x3 affine matrices and the bits of plane geometry the burst tools need.
 *
 * A matrix is [a, b, c, d, e, f]: x' = a x + b y + c, y' = d x + e y + f,
 * the form bro.image.alignSimilarity answers and warpAffineU8 takes.
 * Coordinates are continuous with pixel i covering [i, i + 1) (its centre at
 * i + 0.5), as bro.image's resize, alignment and warp all read them, so a
 * crop at (x0, y0) resized by k is just u = (p - x0) * k.
 *
 *   const m = compose(B, A);          // A first, then B
 *   apply(invert(m), [x, y]);
 *   clipConvex(polyA, polyB);         // the intersection of two convex polygons
 *   rectInConvex(rect, poly);         // all four corners inside
 */

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0]);

/** The matrix that applies `first`, then `then`. */
export function compose(then, first) {
  const [a, b, c, d, e, f] = then;
  const [A, B, C, D, E, F] = first;
  return [a * A + b * D, a * B + b * E, a * C + b * F + c,
          d * A + e * D, d * B + e * E, d * C + e * F + f];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (!det) return IDENTITY.slice();
  const ia = e / det, ib = -b / det, id = -d / det, ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

export function apply(m, [x, y]) {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
}

export const translate = (tx, ty) => [1, 0, tx, 0, 1, ty];
export const scaling = (sx, sy = sx) => [sx, 0, 0, 0, sy, 0];

/** A similarity { scale, rotation, tx, ty } about (cx, cy), as bro.image.similarityMatrix builds it. */
export function similarity({ scale = 1, rotation = 0, tx = 0, ty = 0 }, cx = 0, cy = 0) {
  const ca = scale * Math.cos(rotation), sa = scale * Math.sin(rotation);
  return [ca, -sa, cx + tx - ca * cx + sa * cy, sa, ca, cy + ty - sa * cx - ca * cy];
}

/** The uniform scale of a similarity-like matrix (the square root of its determinant). */
export function scaleOf(m) {
  return Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]));
}

/** The rotation of a similarity-like matrix, in radians. */
export function rotationOf(m) {
  return Math.atan2(m[3], m[0]);
}

/**
 * A matrix that works in crop coordinates (a rect [x, y, w, h] of full
 * coordinates resized to cw x ch) as the same mapping in full coordinates.
 */
export function cropToFull(m, rect, cw, ch) {
  const kx = cw / rect[2], ky = ch / rect[3];
  const into = compose(scaling(kx, ky), translate(-rect[0], -rect[1]));
  const out = compose(translate(rect[0], rect[1]), scaling(1 / kx, 1 / ky));
  return compose(out, compose(m, into));
}

/** The reverse of cropToFull: a full-coordinate mapping in a crop's coordinates. */
export function fullToCrop(m, rect, cw, ch) {
  const kx = cw / rect[2], ky = ch / rect[3];
  const into = compose(scaling(kx, ky), translate(-rect[0], -rect[1]));
  return compose(into, compose(m, invert(into)));
}

// ---- rectangles and polygons ------------------------------------------------------

/** [x, y, w, h] -> its corners, clockwise from top-left. */
export function corners([x, y, w, h]) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** The bounding box [x, y, w, h] of points. */
export function bounds(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/** A rect mapped through m: the quad its corners land on. */
export function mapRect(m, rect) {
  return corners(rect).map((p) => apply(m, p));
}

/** Twice the signed area (positive: clockwise in y-down image coordinates). */
function signedArea2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

/** The polygon wound clockwise (y down), which the tests below assume. */
export function clockwise(poly) {
  return signedArea2(poly) < 0 ? poly.slice().reverse() : poly;
}

export function area(poly) {
  return Math.abs(signedArea2(poly)) / 2;
}

/**
 * The intersection of a polygon with a convex clip polygon (Sutherland-Hodgman),
 * both clockwise. Empty when they do not overlap.
 */
export function clipConvex(subject, clip) {
  let out = clockwise(subject);
  const c = clockwise(clip);
  for (let i = 0; i < c.length && out.length; i++) {
    const [ax, ay] = c[i], [bx, by] = c[(i + 1) % c.length];
    const side = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);   // >= 0: inside
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

/** Whether a point is inside (or on) a clockwise convex polygon, with a little slack. */
export function inConvex(poly, [x, y], eps = 1e-6) {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    if (((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len < -eps) return false;
  }
  return true;
}

/** Whether all of rect lies inside a clockwise convex polygon. */
export function rectInConvex(rect, poly, eps = 1e-6) {
  return corners(rect).every((p) => inConvex(poly, p, eps));
}

/** The centroid of a polygon's area. */
export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (!a) {
    const b = bounds(poly);
    return [b[0] + b[2] / 2, b[1] + b[3] / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
