function parseDuration(text) {
  const read = (unit) => {
    const m = new RegExp('(\d)' + unit).exec(text);
    return m ? Number(m[1]) : 0;
  };
  return read('h') * 3600 + read('m') * 60 + read('s');
}
