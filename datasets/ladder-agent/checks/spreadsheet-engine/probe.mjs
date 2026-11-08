// Hidden probes for spreadsheet-engine; expected.json holds the answers.
// Every probe drives a sheet through src/index.mjs and returns plain values; the
// formula probes return one line per formula: its index, then its value as JSON.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// A small fixed sheet that the formula probes read from. A6 stays empty.
const PRELUDE = [['A1', '10'], ['A2', '20'], ['A3', '30'], ['A4', 'text'], ['A5', 'TRUE'], ['A7', "'7"], ['A8', '=1/0'], ['A9', 'Hello'], ['A10', '-2.5'], ['A11', '=NOSUCH(1)'], ['A12', '=A1+"x"'], ['A13', '=A0']];
const formulas = (list) => async ({ load }) => {
  const { createSheet } = await lib(load);
  return list.map((formula, index) => {
    const sheet = createSheet();
    for (const [ref, input] of PRELUDE) sheet.set(ref, input);
    sheet.set('Z1', formula);
    return `${index}| ${JSON.stringify(sheet.get('Z1'))}`;
  });
};
const sheetWith = async (load, entries) => {
  const { createSheet } = await lib(load);
  const sheet = createSheet();
  for (const [ref, input] of entries) sheet.set(ref, input);
  return sheet;
};

export const probes = [
  {
    name: 'sp01 what a typed input becomes',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const inputs = ['5', '-5.5', '.5', '+3', '5.', '1e3', ' 5', '5 ', 'TRUE', 'false', 'True ', "'abc", "'", "'=1+1", "'TRUE", "''", '=1+1', 'hello', '0', '-0', '007', '1,5', '=', '=  '];
      return inputs.map((input, index) => {
        const sheet = createSheet();
        sheet.set('B2', input);
        return `${index}| ${JSON.stringify([sheet.get('B2'), sheet.input('B2'), sheet.cells()])}`;
      });
    },
  },
  {
    name: 'sp02 references are checked and normalised',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const bad = ['A0', 'AAA1', 'A1001', '1A', 'A 1', '', '$A$1', 'A1 ', ' A1', 'A-1', 'ZZ1001', 'AAA', 'A', '11', 5, null, undefined, {}, ['A1'], 'A01x'];
      const good = ['a1', 'A1', 'zz1000', 'Zz7', 'aB12', 'A001', 'z26'];
      return {
        bad: bad.map((ref) => [attempt(() => sheet.set(ref, '1')), attempt(() => sheet.get(ref)), attempt(() => sheet.input(ref)), attempt(() => sheet.precedents(ref)), attempt(() => sheet.dependents(ref))]),
        good: good.map((ref) => attempt(() => sheet.set(ref, '1'))),
        cells: sheet.cells(),
        lower: [sheet.get('a1'), sheet.get('ZZ1000'), sheet.input('zz1000')],
        inputType: [attempt(() => sheet.set('A1', 5)), attempt(() => sheet.set('A1', null)), attempt(() => sheet.set('A1')), attempt(() => sheet.set('A1', ['x']))],
      };
    },
  },
  {
    name: 'sp03 arithmetic: precedence, associativity and the sign rules',
    run: formulas(['=2+3*4', '=(2+3)*4', '=2^3^2', '=-2^2', '=2^-2', '=--3', '=-+-3', '=10-4-3', '=100/10/5', '=1.5+.5', '=7/2', '=2^0.5', '= 1 +  2 ', '=3-(-3)', '=-(2+3)', '=2^3*2', '=2*3^2', '=-A1^2', '=-A6', '=+A6', '=+A4', '=2*-3', '=2--3', '=1-1-1-1', '=2^2^2^2', '=8/2*4', '=(1+2)*(3+4)/7', '=1+2&3+4', '=1+1=2', '=1&1=11', '="a"&"b"="ab"']),
  },
  {
    name: 'sp04 coercion of text, booleans and empty cells in arithmetic',
    run: formulas(['="5"+1', '=" 5 "+1', '="abc"+1', '=""+1', '=TRUE+1', '=FALSE*5', '=A6+1', '=A7+1', '=A4+1', '=-"3"', '=-"x"', '=+"x"', '=A8+A4', '=A4+A8', '="x"+"y"', '=1+"x"+A8', '="1.5"*2', '=".5"+".5"', '="1e3"+1', '="+4"+"-1"', '=A5*3', '=A5&A5', '=-TRUE', '=A9+0', '=0+" "', '="0x10"+0', '=1-A6', '=A6-A6']),
  },
  {
    name: 'sp05 concatenation and the text of numbers',
    run: formulas(['=1&2', '=TRUE&"x"', '="a"&A6&"b"', '=0.1+0.2&""', '=A10&"!"', '=1/3&""', '=2^70&""', '=A8&"x"', '=1&TRUE&2', '=-0&"x"', '=1E', '=100000000000000000000&""', '=10^21&""', '=0.000001&""', '=0.0000001&""', '=5/2&""', '=A6&A6', '=LEN(0.1+0.2)', '=1.50&""', '=007&""']),
  },
  {
    name: 'sp06 comparison between values of every type',
    run: formulas(['=1<2', '="a"<"B"', '="a"="A"', '=1<"a"', '="a"<TRUE', '=TRUE>5', '=A6=0', '=A6=""', '=A6=FALSE', '=A6=A6', '=A6<1', '=A9="hello"', '="Z"<"a"', '="10"<"9"', '=2>=2', '=1<>1', '=FALSE<TRUE', '=TRUE=1', '="a"<=A6', '=A6<"a"', '=A6<TRUE', '=A6>FALSE', '="B"<"a"', '=10<9', '=-1<-0.5', '="é"="É"', '="a"<>"A"', '=A8=A8', '=A4<A9']),
  },
  {
    name: 'sp07 numeric errors',
    run: formulas(['=1/0', '=0/0', '=0^0', '=0^-1', '=(-8)^(1/3)', '=10^400', '=2^1024', '=1/A6', '=A8', '=10^308*10', '=MOD(5,0)', '=SQRT(4)', '=0^1', '=0^0.5', '=(-8)^3', '=(-1)^0.5', '=2^-1074', '=2^-1080', '=1/3*3', '=10^15+0.5', '=9007199254740993+0']),
  },
  {
    name: 'sp08 the first error wins, and errors come before coercion errors',
    run: formulas(['=A11+A8', '=A8+A11', '=SUM(A12,A11,A8)', '=SUM(A8:A13)', '=SUM(A11:A13)', '=A12&A8', '=IF(A13,1,2)', '=CONCAT(A9,A13,A11)', '=AND(A8,A11)', '=MAX(A12:A13)', '=A4*A12', '=A13*A12', '=-A13', '=A12<A11', '=A8=A8', '=A9&A13&A8', '=ROUND(A4,A8)', '=MOD(A8,A11)', '=MOD(A4,A8)', '=IFERROR(A8,A11)', '=IFERROR(A8+A11,0)']),
  },
  {
    name: 'sp09 SUM, AVERAGE, MIN and MAX read numbers from cells and coerce literals',
    run: formulas(['=SUM(A1:A3)', '=SUM(A1:A10)', '=SUM(A1:A7)', '=SUM(A4)', '=SUM(A5)', '=SUM(TRUE)', '=SUM(TRUE,"3",2)', '=SUM("x")', '=SUM(A1,A2,5)', '=SUM(A3:A1)', '=SUM($A$1:$A$3)', '=SUM(A1:A3,A1:A2)', '=SUM(A6)', '=SUM(A6,A6)', '=SUM(IF(TRUE,A6))', '=AVERAGE(A1:A3)', '=AVERAGE(A4:A6)', '=AVERAGE(A1:A3,A6)', '=AVERAGE(A1,TRUE)', '=MIN(A1:A3)', '=MAX(A1:A10)', '=MAX(A4:A6)', '=MIN(A10,A1)', '=MAX(-5,"3")', '=MIN(A4:A5)', '=SUM(A7)', '=SUM(A7,0)', '=SUM("7",A7)', '=AVERAGE(IF(TRUE,A6),4)', '=SUM(1,2,3,4,5,6,7,8,9,10)', '=SUM(0.1,0.2)', '=MAX(A1,A2,A3,"x")', '=SUM(A1:A3)/COUNT(A1:A3)']),
  },
  {
    name: 'sp10 COUNT and COUNTA',
    run: formulas(['=COUNT(A1:A10)', '=COUNT(A1:A3,1,"2","x",TRUE)', '=COUNT(1/0,2)', '=COUNTA(A1:A10)', '=COUNTA(A6)', '=COUNTA(1/0,"",A6)', '=COUNTA(A6:A6,A1)', '=COUNT(A5)', '=COUNT(A7)', '=COUNT("")', '=COUNTA("")', '=COUNT(A8:A13)', '=COUNTA(A8:A13)', '=COUNT(A6)', '=COUNT(IF(TRUE,A6))', '=COUNTA(Z1)', '=COUNT(A1:A3,A1:A3)', '=COUNT(A0)']),
  },
  {
    name: 'sp11 IF evaluates one branch only',
    run: formulas(['=IF(TRUE,1,2)', '=IF(FALSE,1,2)', '=IF(FALSE,1)', '=IF(0,1,2)', '=IF(5,1,2)', '=IF("true",1,2)', '=IF("yes",1,2)', '=IF(A6,1,2)', '=IF(A8,1,2)', '=IF(TRUE,1,1/0)', '=IF(FALSE,1/0,2)', '=IF(TRUE,1/0,2)', '=IF(TRUE)', '=IF(1,2,3,4)', '=IF(TRUE,A6,5)', '=IF(TRUE,A1:A3,1)', '=IF(A4,1,2)', '=IF(A5,"y","n")', '=IF(A1>5,"big","small")', '=IF(IF(TRUE,FALSE,1/0),1,2)', '=IF(TRUE,IF(FALSE,1,IF(TRUE,7,8)),9)', '=IF(FALSE,NOSUCH(1),3)', '=IF(TRUE,A13,1)', '=IF(FALSE,A13,1)', '=IF(" TRUE ",1,2)', '=IF(-1,1,2)', '=IF(0.0,1,2)']),
  },
  { name: 'sp12 IFERROR', run: formulas(['=IFERROR(1/0,5)', '=IFERROR(7,1/0)', '=IFERROR(A8,"bad")', '=IFERROR(A12,A11)', '=IFERROR(A6,5)', '=IFERROR(1)', '=IFERROR(IFERROR(1/0,2/0),3)', '=IFERROR(A13,"ref")', '=IFERROR(A1,0)', '=IFERROR(A4+1,"text")', '=IFERROR("x"+1,SUM(1,2))', '=IFERROR(SUM(A1:A13),-1)']) },
  {
    name: 'sp13 AND, OR and NOT',
    run: formulas(['=AND(TRUE,TRUE)', '=AND(TRUE,FALSE)', '=OR(FALSE,FALSE)', '=OR(FALSE,1)', '=AND(A1:A3)', '=AND(A4:A6)', '=AND(A4,A6)', '=AND("x")', '=AND("true",1)', '=OR(A8,TRUE)', '=NOT(0)', '=NOT("false")', '=NOT(A6)', '=NOT("x")', '=AND(1/0,FALSE)', '=OR(TRUE,1/0)', '=OR(A4:A6)', '=AND(A1,0)', '=AND(A6)', '=OR(A5,A1:A3)', '=NOT(NOT(5))', '=AND()', '=NOT(A8)']),
  },
  {
    name: 'sp14 ABS, MOD, CONCAT and LEN',
    run: formulas(['=ABS(-3)', '=ABS("-2")', '=ABS(A4)', '=MOD(10,3)', '=MOD(-3,2)', '=MOD(3,-2)', '=MOD(-3,-2)', '=MOD(5.5,2)', '=MOD(1,0)', '=MOD("x",1/0)', '=CONCAT(A1:A3)', '=CONCAT("a",A6,"b",1,TRUE)', '=CONCAT(A8)', '=LEN("hello")', '=LEN(A1)', '=LEN("😀a")', '=LEN(A6)', '=LEN(A1:A2)', '=LEN(TRUE)', '=ABS(-0)', '=MOD(0,5)', '=MOD(7,7)', '=MOD(-7,7)', '=MOD(2,-5)', '=ABS(A6)', '=CONCAT(A4:A6)', '=CONCAT(A9:A10,A4)', '=LEN(A8)']),
  },
  {
    name: 'sp15 ROUND rounds half away from zero on the decimal text',
    run: formulas(['=ROUND(2.675,2)', '=ROUND(1.005,2)', '=ROUND(-2.5)', '=ROUND(2.5)', '=ROUND(1234,-2)', '=ROUND(1250,-2)', '=ROUND(-1250,-2)', '=ROUND(0.5)', '=ROUND(1.9999,3)', '=ROUND(5.55,1)', '=ROUND(1.45,1)', '=ROUND(3.14159,2.9)', '=ROUND(8.5,-0.5)', '=ROUND("2.5")', '=ROUND(-0.4)', '=ROUND(123456789.125,2)', '=ROUND(10^21,2)', '=ROUND(0.285,2)', '=ROUND(-1.005,2)', '=ROUND(1E)', '=ROUND(99.5)', '=ROUND(0.1+0.2,1)', '=ROUND(1.0049999,2)', '=ROUND(5,-1)', '=ROUND(4.9999999999,-1)', '=ROUND(TRUE)', '=ROUND(12.345,1.5)', '=ROUND(7,2)']),
  },
  {
    name: 'sp16 function names, arities and names that are not functions',
    run: formulas(['=sum(1,2)', '=Sum(1)', '=SUM()', '=SUM(1,)', '=IF(1)', '=NOT()', '=ROUND(1,2,3)', '=NOSUCH(1/0)', '=foo', '=AAA1', '=A0', '=A1001', '=ZZ1000', '=ZZ1001', '=true', '=False&""', '=sum', '=MOD(1)', '=ROUND(1/0,2,3)', '=NOSUCH()', '=IF()', '=AND()', '=LEN(1,2)', '=ABS()', '=COUNT()', '=IFERROR(1,2,3)', '=a1+A2', '=a$1+$A2', '=zz1', '=_x', '=A1.5', '=SUM.X(1)']),
  },
  {
    name: 'sp17 formulas that do not parse',
    run: formulas(['=', '=   ', '=1+', '=(1+2', '=1+2)', '=1 2', '="abc', '=SUM(1,,2)', '=SUM(,)', '=1 +* 2', '=#', '=A1:', '=A1:5', '=:A1', '=A1:B', '=1:2', '=@x', "='a'", '=1..2', '=A1 B1', '=SUM(1 2)', '=((((1)))', '= + ', '=,', '=1,2', '="a""b"', '="a"""', '=""""&""', '="say ""hi"""', '=1 % 2', '=!1', '=A1:A2:A3', '=SUM(A1:A2:A3)', '=(', '=)', '=NOSUCH(', '=1+(', '=-', '=1;2', '=2 ** 3', '=1=<2', '="a"&', '=IF(TRUE,1,)']),
  },
  {
    name: 'sp18 ranges',
    run: formulas(['=SUM(A3:A1)', '=A1:A3', '=A1:A3+1', '=SUM(A1:A2)*2', '=ABS(A1:A2)', '=SUM(A1:A1001)', '=SUM(A0:A3)', '=COUNT(A1:AAA3)', '=IF(TRUE,1,SUM(A1:A1001))', '=IF(FALSE,1,SUM(A1:A1001))', '=SUM($A$1:A$3)', '=SUM(a1:a3)', '=SUM(A1:A3)+SUM(A2:A3)', '=COUNTA(A1:A1001)', '=CONCAT(A1:A1001)', '=SUM(A1:A1)', '=MAX(A1:B3)', '=COUNTA(A1:C13)', '=SUM(B1:B3)', '=SUM(A 1:A3)', '=SUM(A1: A3)', '=SUM(A1 :A3)', '=-A1:A3', '=A1:A3&"x"', '=NOT(A1:A3)', '=AND(A1:A3,A5)', '=IFERROR(A1:A3,1)', '=IF(A1:A3,1,2)']),
  },
  {
    name: 'sp19 precedents and dependents',
    run: async ({ load }) => {
      const sheet = await sheetWith(load, [['C3', '=SUM(A1:A2)+B1+A1'], ['D4', '=C3*2'], ['E1', '=IF(FALSE,Z9,0)'], ['F1', '=SUM(A1:B2)'], ['G1', '=A0+B1'], ['H1', '=SUM(A1:A1001)+C1'], ['I1', '=1+'], ['J1', '=$A$1+a1+A1'], ['K1', '5'], ['L1', '=K1:K3']]);
      const refs = ['C3', 'D4', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'L1', 'A1', 'A2', 'B1', 'B2', 'Z9', 'C1', 'K2', 'ZZ1000'];
      return refs.map((ref) => [ref, sheet.precedents(ref), sheet.dependents(ref)]);
    },
  },
  {
    name: 'sp20 the cells that set recomputes, in order',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const out = [];
      out.push(sheet.set('A1', '1'));
      for (const [ref, input] of [['C1', '=A1'], ['A2', '=A1'], ['B2', '=A1'], ['B3', '=A1'], ['D1', '=C1+B3'], ['E1', '=D1+A2'], ['AA1', '=A1'], ['A3', '=SUM(A1:A2)'], ['B1', '=A1*2']]) out.push(sheet.set(ref, input));
      out.push(sheet.set('A1', '5'));
      out.push(sheet.set('B3', '=D1'));
      out.push(sheet.set('A1', '6'));
      out.push(sheet.set('C1', ''));
      out.push(sheet.set('Z9', 'x'));
      out.push(sheet.set('A2', '3'));
      return { out, values: sheet.cells().map((ref) => [ref, sheet.get(ref)]) };
    },
  },
  {
    name: 'sp21 only the dependents are evaluated',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const counts = [];
      const step = (fn) => {
        const before = sheet.evaluations();
        const result = fn();
        counts.push([sheet.evaluations() - before, result]);
      };
      step(() => sheet.set('A1', '1'));
      step(() => sheet.set('A2', '2'));
      step(() => sheet.set('B1', '=A1+1'));
      step(() => sheet.set('B2', '=A2+1'));
      step(() => sheet.set('C1', '=B1+B2'));
      step(() => sheet.set('A1', '10'));
      step(() => sheet.set('A2', '20'));
      step(() => sheet.set('A9', '99'));
      step(() => sheet.set('B1', '=A1+1'));
      step(() => sheet.set('C1', '=B2'));
      step(() => sheet.set('A1', '11'));
      step(() => sheet.set('A2', '21'));
      step(() => sheet.set('B2', '4'));
      step(() => sheet.set('B2', ''));
      step(() => sheet.set('D1', '=1+'));
      step(() => sheet.set('D1', 'now text'));
      return { counts, total: sheet.evaluations(), values: [sheet.get('B1'), sheet.get('B2'), sheet.get('C1'), sheet.get('D1')] };
    },
  },
  {
    name: 'sp22 there is no early cut-off: a dependent is recomputed even when its value stays',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      sheet.set('A1', '5');
      sheet.set('B1', '=A1>3');
      sheet.set('C1', '=IF(B1,"yes","no")');
      sheet.set('D1', '=C1&"!"');
      sheet.set('E1', '=A1*0');
      sheet.set('F1', '=E1+1');
      const before = sheet.evaluations();
      const first = sheet.set('A1', '6');
      const second = sheet.set('A1', '6');
      return { first, second, evaluated: sheet.evaluations() - before, values: [sheet.get('C1'), sheet.get('D1'), sheet.get('F1')] };
    },
  },
  {
    name: 'sp23 cycles get #CYCLE! and head the list',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const out = [];
      out.push(sheet.set('A1', '=A1+1'));
      out.push(sheet.set('B1', '=C1'));
      out.push(sheet.set('C1', '=D1'));
      out.push(sheet.set('D1', '=B1'));
      out.push(sheet.set('E1', '=B1+1'));
      out.push(sheet.set('F1', '=IFERROR(B1,"fallback")'));
      out.push(sheet.set('G1', '=SUM(E1,A1)'));
      out.push(sheet.set('H1', '=IF(FALSE,B1,7)'));
      return { out, values: sheet.cells().map((ref) => [ref, sheet.get(ref)]), evaluations: sheet.evaluations() };
    },
  },
  {
    name: 'sp24 breaking and making cycles later',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const out = [];
      for (const [ref, input] of [['A1', '=B1'], ['B1', '=C1'], ['C1', '=A1'], ['D1', '=A1+B1'], ['E1', '=D1*2']]) out.push(sheet.set(ref, input));
      const before = sheet.evaluations();
      out.push(sheet.set('C1', '3'));
      const afterBreak = [sheet.get('A1'), sheet.get('B1'), sheet.get('D1'), sheet.get('E1')];
      out.push(sheet.set('C1', '=E1'));
      const afterMake = [sheet.get('A1'), sheet.get('B1'), sheet.get('D1'), sheet.get('E1')];
      out.push(sheet.set('E1', '1'));
      const afterFix = [sheet.get('A1'), sheet.get('B1'), sheet.get('C1'), sheet.get('D1'), sheet.get('E1')];
      out.push(sheet.set('A1', '=A1'));
      return { out, afterBreak, afterMake, afterFix, evaluations: sheet.evaluations() - before, last: [sheet.get('A1'), sheet.get('B1'), sheet.get('C1')] };
    },
  },
  {
    name: 'sp25 a cycle through a range and a cycle around an IF',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const out = [];
      for (const [ref, input] of [['A1', '1'], ['A2', '2'], ['A3', '=SUM(A1:A3)'], ['B1', '=IF(TRUE,1,B2)'], ['B2', '=B1'], ['C1', '=SUM(A1:A3)+1'], ['C2', '=COUNTA(C1:C3)'], ['C3', '=C2']]) out.push(sheet.set(ref, input));
      out.push(sheet.set('A1', '5'));
      out.push(sheet.set('A3', '9'));
      return { out, values: sheet.cells().map((ref) => [ref, sheet.get(ref)]) };
    },
  },
  {
    name: 'sp26 several cycles at once and cells between them',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const out = [];
      for (const [ref, input] of [['A1', '=A2'], ['A2', '=A3'], ['A3', '=A1'], ['B1', '=B2'], ['B2', '=B1'], ['C1', '=A1+B1'], ['C2', '=C1'], ['D1', '=C2+D2'], ['D2', '=D1']]) out.push(sheet.set(ref, input));
      out.push(sheet.set('X1', '1'));
      out.push(sheet.set('A3', '=X1'));
      out.push(sheet.set('B2', '=X1+1'));
      out.push(sheet.set('D2', '0'));
      return { out, values: sheet.cells().map((ref) => [ref, sheet.get(ref)]), evaluations: sheet.evaluations() };
    },
  },
  {
    name: 'sp27 replacing a formula replaces its dependencies',
    run: async ({ load }) => {
      const sheet = await sheetWith(load, [['A1', '1'], ['A2', '2'], ['A3', '3'], ['B1', '=A1+A2']]);
      const out = [];
      out.push([sheet.precedents('B1'), sheet.dependents('A1'), sheet.dependents('A2')]);
      out.push(sheet.set('B1', '=A2+A3'));
      out.push([sheet.precedents('B1'), sheet.dependents('A1'), sheet.dependents('A2'), sheet.dependents('A3')]);
      const before = sheet.evaluations();
      out.push(sheet.set('A1', '100'));
      out.push(sheet.evaluations() - before);
      out.push(sheet.set('B1', '5'));
      out.push([sheet.precedents('B1'), sheet.dependents('A2'), sheet.dependents('A3'), sheet.get('B1')]);
      out.push(sheet.set('B1', '=SUM(A1:A3)'));
      out.push(sheet.set('B1', '=1+'));
      out.push([sheet.precedents('B1'), sheet.dependents('A1'), sheet.get('B1')]);
      out.push(sheet.set('A2', '7'));
      out.push(sheet.set('B1', ''));
      out.push([sheet.precedents('B1'), sheet.cells()]);
      return out;
    },
  },
  {
    name: 'sp28 cells() and lists are in reading order',
    run: async ({ load }) => {
      const sheet = await sheetWith(load, [['B2', '1'], ['A2', '2'], ['AA1', '3'], ['ZZ1000', '4'], ['A1', '5'], ['Z1', '6'], ['AB1', '7'], ['A10', '8'], ['A9', '9'], ['B1', '=SUM(AA1:AB2)+A10+A9+ZZ1000+Z1'], ['C1', '=B1'], ['AZ1', '=B1+C1']]);
      return { cells: sheet.cells(), precedents: sheet.precedents('B1'), dependents: sheet.dependents('B1'), set: sheet.set('AA1', '9'), more: sheet.set('A9', '1') };
    },
  },
  {
    name: 'sp29 what a formula reads from text, empty and error cells',
    run: async ({ load }) => {
      const sheet = await sheetWith(load, [['A1', 'word'], ['A2', "'12"], ['A3', '=1/0'], ['A4', '=A1'], ['A5', '=A6'], ['A6', ''], ['A7', '=B7'], ['B1', '=A1&A2'], ['B2', '=A2*2'], ['B3', '=A3'], ['B4', '=A4&"!"'], ['B5', '=A5=0'], ['B6', '=ISNUM'], ['B7', '=TRUE']]);
      return sheet.cells().map((ref) => [ref, sheet.get(ref), sheet.input(ref)]);
    },
  },
  {
    name: 'sp30 sheets do not share anything, error values are copies',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const a = createSheet();
      const b = createSheet();
      a.set('A1', '5');
      b.set('A1', '=1/0');
      a.set('B1', '=A1+1');
      const error = b.get('A1');
      error.error = 'changed';
      error.extra = 1;
      const again = b.get('A1');
      b.set('B1', '=A1');
      return { a: [a.get('A1'), a.get('B1'), a.cells(), a.evaluations()], b: [again, b.get('B1'), b.cells(), b.evaluations()], same: b.get('A1') === b.get('A1') };
    },
  },
  {
    name: 'sp31 a small budget sheet through several edits',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const log = [];
      const entries = [
        ['A1', 'Item'], ['B1', 'Qty'], ['C1', 'Price'], ['D1', 'Total'],
        ['A2', 'Bolt'], ['B2', '10'], ['C2', '0.25'], ['D2', '=B2*C2'],
        ['A3', 'Nut'], ['B3', '25'], ['C3', '0.1'], ['D3', '=B3*C3'],
        ['A4', 'Washer'], ['B4', '40'], ['C4', '0.05'], ['D4', '=B4*C4'],
        ['D6', '=SUM(D2:D4)'], ['D7', '=D6*0.2'], ['D8', '=ROUND(D6+D7,1)'], ['A8', '=IF(D8>10,"over","ok")&" budget"'],
        ['B6', '=SUM(B2:B4)'], ['C6', '=AVERAGE(C2:C4)'], ['A6', '=COUNTA(A2:A4)&" items"'],
      ];
      for (const [ref, input] of entries) log.push(sheet.set(ref, input));
      log.push(sheet.set('B3', '100'));
      log.push(sheet.set('C4', 'free'));
      log.push(sheet.set('C4', '0.5'));
      log.push(sheet.set('A5', 'Screw'), sheet.set('B5', '5'), sheet.set('C5', '1'), sheet.set('D5', '=B5*C5'));
      log.push(sheet.set('D6', '=SUM(D2:D5)'));
      log.push(sheet.set('A6', '=COUNTA(A2:A5)&" items"'));
      return { log, values: sheet.cells().map((ref) => [ref, sheet.get(ref)]), evaluations: sheet.evaluations() };
    },
  },
  {
    name: 'sp32 whitespace and line breaks inside a formula',
    run: formulas(['=  1  +\n2', '=\t1\t+\t2', '= SUM ( 1 , 2 )', '=SUM (1,2)', '= A1 : A3 ', '=SUM(A1 : A3)', '=A1\n+\nA2', '=IF (TRUE , 1 , 2)', '= -  1', '=1 - - 1', '="a b" & " c"', '=  ', '=\n']),
  },
  {
    name: 'sp33 three thousand formulas in dependency chains',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const t0 = cpuMs();
      const sheet = createSheet();
      const n = 1000;
      sheet.set('A1', '1');
      for (let row = 2; row <= n; row += 1) sheet.set(`A${row}`, `=A${row - 1}+1`);
      for (let row = 1; row <= n; row += 1) sheet.set(`B${row}`, `=A${row}*2`);
      for (let row = 2; row <= n; row += 1) sheet.set(`C${row}`, `=B${row}+C${row - 1}`);
      if (cpuMs() - t0 > 3000) return { slow: true };
      const out = sheet.set('A1', '10');
      const rows = [];
      for (let k = 0; k < 20; k += 1) {
        sheet.set('A1', String(k));
        if (cpuMs() - t0 > 3000) return { slow: true };
      }
      sheet.set('A1', '10');
      rows.push(sheet.get(`A${n}`), sheet.get(`B${n}`), sheet.get(`C${n}`));
      return { fast: cpuMs() - t0 < 3000, recomputed: out.length, head: out.slice(0, 6), tail: out.slice(-3), rows, evaluations: sheet.evaluations() };
    },
  },
  {
    name: 'sp34 five hundred formulas summing the same five hundred cells',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const t0 = cpuMs();
      const sheet = createSheet();
      for (let row = 1; row <= 500; row += 1) sheet.set(`A${row}`, String(row));
      for (let row = 1; row <= 500; row += 1) sheet.set(`B${row}`, `=SUM(A$1:A$500)+${row}`);
      if (cpuMs() - t0 > 3000) return { slow: true };
      const out = sheet.set('A250', '1000');
      for (let k = 0; k < 5; k += 1) {
        sheet.set('A1', String(k));
        if (cpuMs() - t0 > 3500) return { slow: true };
      }
      sheet.set('A1', '1');
      return { fast: cpuMs() - t0 < 3500, recomputed: out.length, first: out[0], last: out[out.length - 1], sample: [sheet.get('B1'), sheet.get('B500')], evaluations: sheet.evaluations() };
    },
  },
  {
    name: 'sp35 deeply nested and very long formulas parse',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const nested = `${'('.repeat(400)}1${')'.repeat(400)}`;
      const deepCalls = `${'ABS('.repeat(200)}-3${')'.repeat(200)}`;
      const sum = Array.from({ length: 1000 }, (_, i) => String(i)).join('+');
      const concat = Array.from({ length: 300 }, () => '"ab"').join('&');
      const unary = `${'-'.repeat(301)}5`;
      const args = `SUM(${Array.from({ length: 500 }, (_, i) => i).join(',')})`;
      const unclosed = `${'('.repeat(400)}1${')'.repeat(399)}`;
      const results = [nested, deepCalls, sum, concat, unary, args, unclosed].map((formula, index) => {
        sheet.set(`A${index + 1}`, `=${formula}`);
        const value = sheet.get(`A${index + 1}`);
        return typeof value === 'string' ? value.length : value;
      });
      return results;
    },
  },
  {
    name: 'sp36 random edits of a random sheet: the lists and the values',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const out = [];
      for (const seed of [1, 2, 3]) {
        const rnd = prng(seed);
        const sheet = createSheet();
        const pick = (n) => Math.floor(rnd() * n);
        const ref = () => `${String.fromCharCode(65 + pick(5))}${1 + pick(8)}`;
        const formula = () => {
          const kind = pick(6);
          if (kind === 0) return `=${ref()}+${ref()}`;
          if (kind === 1) return `=SUM(${ref()}:${ref()})`;
          if (kind === 2) return `=IF(${ref()}>3,${ref()},${ref()}*2)`;
          if (kind === 3) return `=MAX(${ref()},${ref()},${pick(9)})`;
          if (kind === 4) return `=IFERROR(${ref()}/${ref()},-1)`;
          return `=${ref()}&${ref()}`;
        };
        const trace = [];
        for (let step = 0; step < 90; step += 1) {
          const roll = rnd();
          const target = ref();
          const input = roll < 0.35 ? String(pick(10)) : roll < 0.9 ? formula() : '';
          trace.push([target, sheet.set(target, input)]);
        }
        out.push({ trace, values: sheet.cells().map((r) => [r, sheet.get(r)]), evaluations: sheet.evaluations() });
      }
      return out;
    },
  },
  {
    name: 'sp37 ready cells go in reading order',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      for (const [ref, input] of [['A1', '1'], ['B3', '=A1'], ['B2', '=A1'], ['C1', '=A1'], ['A2', '=A1'], ['D1', '=C1+B3'], ['A3', '=D1+B2'], ['Z1', '=A2'], ['A4', '=B3+B2+C1'], ['C2', '=A1']]) sheet.set(ref, input);
      const first = sheet.set('A1', '2');
      const second = sheet.set('B2', '=A1+10');
      const third = sheet.set('C1', '=C2');
      return { first, second, third };
    },
  },
  {
    name: 'sp38 mentions of empty and missing cells',
    run: async ({ load }) => {
      const sheet = await sheetWith(load, [['A1', '=B1+C1'], ['B1', '=ZZ1000'], ['A2', '=A0+1'], ['A3', '=IF(FALSE,A1001,2)'], ['A4', '=SUM(B1:B3)']]);
      const out = [];
      out.push(sheet.set('ZZ1000', '5'));
      out.push(sheet.set('C1', '1'));
      out.push(sheet.set('B2', '4'));
      out.push([sheet.get('A1'), sheet.get('B1'), sheet.get('A2'), sheet.get('A3'), sheet.get('A4')]);
      out.push([sheet.dependents('ZZ1000'), sheet.dependents('B2'), sheet.precedents('A2'), sheet.precedents('A3')]);
      return out;
    },
  },
  {
    name: 'sp39 a long mixed scenario with every error and clearing',
    run: async ({ load }) => {
      const { createSheet } = await lib(load);
      const sheet = createSheet();
      const out = [];
      const entries = [['A1', '4'], ['A2', '=1/A1'], ['A3', '=A2*A1'], ['B1', '=IFERROR(A2,0)'], ['B2', '=A3=1'], ['B3', '=IF(B2,"exact","off")'], ['C1', '=B3&A1'], ['C2', '=LEN(C1)'], ['C3', '=SUM(A1:C2)']];
      for (const [ref, input] of entries) out.push(sheet.set(ref, input));
      out.push(sheet.set('A1', '0'));
      out.push([sheet.get('A2'), sheet.get('A3'), sheet.get('B1'), sheet.get('B2'), sheet.get('B3'), sheet.get('C1'), sheet.get('C2'), sheet.get('C3')]);
      out.push(sheet.set('A1', ''));
      out.push([sheet.get('A2'), sheet.get('A3'), sheet.get('C3')]);
      out.push(sheet.set('A1', 'x'));
      out.push([sheet.get('A2'), sheet.get('A3'), sheet.get('C3')]);
      out.push(sheet.set('A1', '3'));
      out.push([sheet.get('A2'), sheet.get('A3'), sheet.get('B2'), sheet.get('B3')]);
      return out;
    },
  },
];
