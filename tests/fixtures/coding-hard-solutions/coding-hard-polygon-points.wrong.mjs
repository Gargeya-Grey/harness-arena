function classifyPoints(polygon, points) {
  return points.map(([px, py]) => {
    let inside = false;
    for (let i = 0; i < polygon.length; i += 1) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[(i + 1) % polygon.length];
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cross === 0 && Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by)) {
        return 'boundary';
      }
      if (ay > py !== by > py) {
        if (by > ay ? cross > 0 : cross < 0) inside = !inside;
      }
    }
    return inside ? 'inside' : 'outside';
  });
}
