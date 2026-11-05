function classifyPoints(polygon, points) {
  const P = polygon.map(([x, y]) => [BigInt(x), BigInt(y)]);
  const lo = (a, b) => (a < b ? a : b);
  const hi = (a, b) => (a < b ? b : a);
  return points.map(([qx, qy]) => {
    const px = BigInt(qx);
    const py = BigInt(qy);
    let inside = false;
    for (let i = 0; i < P.length; i += 1) {
      const [ax, ay] = P[i];
      const [bx, by] = P[(i + 1) % P.length];
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cross === 0n && lo(ax, bx) <= px && px <= hi(ax, bx) && lo(ay, by) <= py && py <= hi(ay, by)) {
        return 'boundary';
      }
      if (ay > py !== by > py) {
        if (by > ay ? cross > 0n : cross < 0n) inside = !inside;
      }
    }
    return inside ? 'inside' : 'outside';
  });
}
