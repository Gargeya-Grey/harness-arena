function cidrContains(cidr, ip) {
  const octets = (text) => {
    const parts = text.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
      if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null;
      value = value * 256 + Number(part);
    }
    return value;
  };
  const slash = cidr.split('/');
  if (slash.length !== 2) return false;
  if (!/^(0|[1-9]\d?)$/.test(slash[1]) || Number(slash[1]) > 32) return false;
  const base = octets(slash[0]);
  const addr = octets(ip);
  if (base === null || addr === null) return false;
  const block = 2 ** (32 - Number(slash[1]));
  return Math.floor(base / block) === Math.floor(addr / block);
}
