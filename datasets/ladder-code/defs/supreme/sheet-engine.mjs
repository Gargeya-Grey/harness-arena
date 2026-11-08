import { t } from './_util.mjs';

const spec = [
  'evaluateSheet(cells) computes a small spreadsheet. cells is an object that maps a cell id to the content of that cell, a string. Return an object with the same keys, in which every value is the text that the cell displays.',
  '',
  'CELL IDS. A cell id is one capital letter A-Z followed by a row number from 1 to 99 without a leading zero, such as A1 or Z99. A cell id that is not a key of cells is a blank cell. The keys of cells are always valid ids.',
  '',
  'CELL KINDS. The content of a cell decides its kind. (1) The empty string is a blank cell. (2) A string that starts with = is a formula; the text after the = is the formula. (3) A string made of an optional minus sign, then one or more digits, then optionally a point followed by one or more digits (for example 12, -3, 007, 2.50) is a number cell. (4) Any other string is a text cell and it displays as it is; so " 5", "1e3", "+4", ".5", "5." and "-" are text.',
  '',
  'DISPLAY. A number is displayed as x.toFixed(6) with the trailing zeros after the decimal point removed, and the point removed too when no digit is left after it; a result "-0" is displayed as "0". So 2.50 displays as 2.5, 007 as 7, 1/3 as 0.333333 and 3.14159265 as 3.141593. A blank cell displays as the empty string. An error displays as its code. A text displays as it is. When the final value of a formula is blank, the cell holds the number 0 instead (so a formula =A1 with A1 blank displays 0).',
  '',
  'FORMULA SYNTAX. Spaces and tabs between tokens are ignored. The tokens are: a number (digits, optionally a point and digits); a string in double quotes, where two double quotes inside stand for one quote character; a cell reference, which is one or more capital letters directly followed by one or more digits (A1, and also AB12, A100 and A0, which are not valid cell ids, see REFERENCES); a function name, which is one or more capital letters directly followed by ( ; and the symbols ( ) , : + - * / ^ & = <> <= >= < >. Anything else is a syntax error, including lowercase letters, and capital letters that are neither a reference nor a function name.',
  'Operators from the loosest to the tightest: comparison (= <> < <= > >=), then &, then + and -, then * and /, then ^, then prefix minus. All binary operators are left associative, including ^: 2^3^2 is (2^3)^2 = 64. Prefix minus binds tighter than ^: -2^2 is (-2)^2 = 4, -2^-2 is (-2)^(-2) = 0.25, and 2^-1 is 0.5. An atom is a number, a string, a reference, a range (two references with : between them), a function call name(arg, arg, ...) with zero or more arguments, or an expression in parentheses. The whole formula must be exactly one expression; otherwise it is a syntax error, and the cell shows #ERR!.',
  '',
  'VALUES AND ERRORS. A value is a number, a text, a blank, or an error. The error codes are #ERR! (syntax error), #REF!, #VALUE!, #DIV/0!, #NAME? and #CYCLE!. A reference to a cell whose value is an error gives that error. A reference gives: blank for a blank cell or a cell that is not in cells, the number of a number cell, the text of a text cell, the computed value of a formula cell.',
  'REFERENCES. An invalid cell id (such as A0, A100, A01 or AB1) gives #REF! when the reference is evaluated, so it does nothing when it sits in a branch that is not evaluated.',
  'RANGES. A range lists the cells of the rectangle between its two corners, whichever corner is written first, row by row (B2:A1 is the same as A1:B2; the order is A1, B1, A2, B2). If either corner is not a valid cell id, the range gives #REF!. A range gives #VALUE! when it is evaluated anywhere except as a direct argument of SUM, AVG, MIN, MAX or COUNT. A direct argument of IF, ROUND or ABS that is a range gives #VALUE! (this is checked before the number of arguments).',
  '',
  'OPERATORS. To evaluate a binary operator, evaluate the left operand, then the right operand. If the left operand is an error, that error is the result and the right operand is not evaluated; otherwise if the right operand is an error, that error is the result.',
  '- For + - * / ^ both operands become numbers: a number stays, a blank counts as 0, a text gives #VALUE!. Division by 0 gives #DIV/0!. A result of these operators (and of SUM and AVG) that is not a finite number, or that has an absolute value of 10^15 or more, gives #VALUE! instead; so 0^-1 and (-8)^0.5 give #VALUE!. Prefix minus needs a number or a blank (as 0), otherwise #VALUE!, and an error stays that error.',
  '- & joins two texts: a number becomes its displayed text, a blank becomes the empty text, a text stays. The result is a text.',
  '- = <> < <= > >= give the number 1 when true and 0 when false. If both operands are numbers or blanks, they are compared as numbers (a blank counts as 0). If both are texts, or one is a text and the other is a blank (the blank counts as the empty text), they are compared by character code, case-sensitive (so "A" < "a" and "10" < "9"). A text compared with a number gives #VALUE!.',
  '',
  'FUNCTIONS. The functions are SUM, AVG, MIN, MAX, COUNT, IF, ROUND and ABS. Any other name gives #NAME? and its arguments are not evaluated.',
  '- SUM, AVG, MIN, MAX and COUNT scan their arguments in order and collect numbers. For a range, the cells are scanned row by row: an error value ends the scan and is the result of the function; a number is collected; a blank or text is skipped. For any other argument, evaluate it: an error is the result of the function; a number is collected; a blank is collected as 0; a text gives #VALUE!. Then SUM adds the collected numbers (0 when there are none); AVG gives their sum divided by their count (#DIV/0! when there are none); MIN and MAX give the smallest and the largest (0 when there are none); COUNT gives how many were collected.',
  '- IF(c, a, b) needs exactly 3 arguments, otherwise #VALUE!. Evaluate c: an error is the result; c must be a number or a blank (as 0), otherwise #VALUE!. If c is not 0 the result is the value of a, else the value of b. Only the chosen one of a and b is evaluated, so an error in the other one never shows.',
  '- ROUND(x, d) needs exactly 2 arguments, otherwise #VALUE!. Evaluate x, then d; an error in x is the result, else an error in d. Then x and d must be numbers or blanks (as 0), otherwise #VALUE!, and d must be a whole number from 0 to 6, otherwise #VALUE!. The result is Math.sign(x) * Math.round(Math.abs(x) * 10 ** d) / 10 ** d, computed in double arithmetic.',
  '- ABS(x) needs exactly 1 argument, otherwise #VALUE!. An error in x is the result; x must be a number or a blank (as 0), otherwise #VALUE!. The result is the absolute value.',
  '',
  'CYCLES. A formula depends on every cell named in it: each valid reference, and every cell of each range whose corners are valid. This includes cells named in branches of IF that are not chosen and in the arguments of unknown functions, and cells that are not in cells. A formula with a syntax error depends on nothing. A cell is on a cycle when following dependencies from it leads back to it; a formula that names its own cell is on a cycle. Every cell that is on a cycle, and every cell that depends directly or indirectly on a cell on a cycle, shows #CYCLE! whatever its content is. This check is done first and overrides every other result.',
  '',
  'SIZE. A sheet can have up to a few hundred cells and long chains of dependencies, for example 40 cells where each cell adds the next cell to itself twice (A1 is =A2+A2). The value of a cell must not be computed again for each use of it.',
].join('\n');

const chain = (length) => {
  const cells = {};
  for (let row = 1; row < length; row += 1) cells[`A${row}`] = `=A${row + 1}+A${row + 1}`;
  cells[`A${length}`] = '1';
  return cells;
};

const invoice = () => {
  const cells = { A1: 'Item', B1: 'Qty', C1: 'Price', D1: 'Total', E1: 'Note' };
  const rows = [
    ['pen', '12', '1.25'],
    ['book', '3', '14.9'],
    ['lamp', '1', '39.99'],
    ['cable', '0', '7.5'],
    ['desk', '2', '120'],
    ['chair', '', '85.5'],
  ];
  rows.forEach(([item, qty, price], index) => {
    const r = index + 2;
    cells[`A${r}`] = item;
    cells[`B${r}`] = qty;
    cells[`C${r}`] = price;
    cells[`D${r}`] = `=B${r}*C${r}`;
    cells[`E${r}`] = `=IF(B${r}=0,"out",IF(D${r}>100,"big","ok"))`;
  });
  cells.A9 = 'Sum';
  cells.D9 = '=SUM(D2:D7)';
  cells.A10 = 'Average';
  cells.D10 = '=ROUND(AVG(D2:D7),2)';
  cells.A11 = 'Items';
  cells.D11 = '=COUNT(B2:B7)';
  cells.A12 = 'Largest';
  cells.D12 = '=MAX(D2:D7)&" ("&COUNT(D2:D7)&")"';
  cells.D13 = '=D9/B7';
  cells.D14 = '=D9/(B5)';
  cells.E9 = '=IF(D9>=500,"above budget","within budget")';
  return cells;
};

// Hand-derived tests: the displayed value of each cell was worked out from the task text alone, before the reference
// solution was run on it, and is stored here as written (generate.mjs does not compute it).
const hand = [
  t('cell-kinds', [{
    A1: '12', A2: '-3', A3: '007', A4: '2.50', A5: ' 5',
    A6: '1e3', A7: '+4', A8: '.5', A9: '5.', A10: '-',
    A11: '', A12: '-0', A13: '00.50', A14: '12abc', A15: '--1',
    A16: '1 2', A17: ' =1+1', A18: '=1+1', B1: '=A1+A2+A3+A4', C1: '=A5&"|"',
    C2: '=A5+1', C3: '=A8+1',
  }], {
    A1: '12', A2: '-3', A3: '7', A4: '2.5', A5: ' 5',
    A6: '1e3', A7: '+4', A8: '.5', A9: '5.', A10: '-',
    A11: '', A12: '0', A13: '0.5', A14: '12abc', A15: '--1',
    A16: '1 2', A17: ' =1+1', A18: '2', B1: '18.5', C1: ' 5|',
    C2: '#VALUE!', C3: '#VALUE!',
  }),
  t('display-format', [{
    A1: '=1/3', A2: '=2/3', A3: '=10/4', A4: '=100', A5: '=1/8',
    A6: '=0.1+0.2', A7: '=7/1000000', A8: '=4/10000000', A9: '=1000000*1000', A10: '=0-1/10000000',
    A11: '=3.14159265', A12: '=1000000.1234567',
  }], {
    A1: '0.333333', A2: '0.666667', A3: '2.5', A4: '100', A5: '0.125',
    A6: '0.3', A7: '0.000007', A8: '0', A9: '1000000000', A10: '0',
    A11: '3.141593', A12: '1000000.123457',
  }),
  t('formula-blank', [{
    A1: '', B1: '=A1', C1: '=A1&"x"', D1: '=A1=0', E1: '=A1=""',
    F1: '=-A1', G1: '=A9', H1: '=IF(A1,1,2)',
  }], { A1: '', B1: '0', C1: 'x', D1: '1', E1: '1', F1: '0', G1: '0', H1: '2' }),
  t('formula-blank', [{
    A1: '=A9', B1: '=A1&"x"', C1: '=A1=""', D1: '=IF(1,A9,2)', E1: '=A9+A8',
    F1: '=A9^0', G1: '=5-A9', H1: '=5/A9', I1: '=A9<"a"', J1: '=A9=A8',
  }], {
    A1: '0', B1: '0x', C1: '#VALUE!', D1: '0', E1: '0',
    F1: '1', G1: '5', H1: '#DIV/0!', I1: '1', J1: '1',
  }),
  t('pow-left', [{
    A1: '=2^3^2', B1: '=-2^2', C1: '=2^-1', D1: '=-2^-2', E1: '=2*3^2',
    F1: '=2^3*2', G1: '=-2*-3',
  }], { A1: '64', B1: '4', C1: '0.5', D1: '0.25', E1: '18', F1: '16', G1: '6' }),
  t('neg-tighter', [{
    A1: '3', B1: '=-A1^2', C1: '=0-A1^2', D1: '=-(A1^2)', E1: '=2-3^2',
    F1: '=-A1^-A1', G1: '=--A1', H1: '=1--1',
  }], { A1: '3', B1: '9', C1: '-9', D1: '-9', E1: '-7', F1: '-0.037037', G1: '3', H1: '2' }),
  t('precedence', [{
    A1: '=1+2*3-4/2', B1: '=(1+2)*3', C1: '="a"&1+2&"b"', D1: '=1<2=1', E1: '=1+1=2&"x"',
    F1: '=2>1+1', G1: '=2*3&4*5', H1: '=10-4-3', I1: '=100/10/5', J1: '=1&2=12',
  }], {
    A1: '5', B1: '9', C1: 'a3b', D1: '1', E1: '#VALUE!',
    F1: '0', G1: '620', H1: '3', I1: '2', J1: '#VALUE!',
  }),
  t('string-escape', [{
    A1: '="say ""hi"""', B1: '=""&"x"', C1: '="a""b"&A1', D1: '="abc', E1: '="""',
    F1: '="a"&""""&"b"', G1: '="" = ""',
  }], { A1: 'say "hi"', B1: 'x', C1: 'a"bsay "hi"', D1: '#ERR!', E1: '#ERR!', F1: 'a"b', G1: '1' }),
  t('concat', [{
    A1: '3.5', A2: '', A3: 't', B1: '=A1&A2&A3', B2: '=1/3&"|"&-0',
    B3: '=1&2+3', B4: '=A1*2&"x"', B5: '=A9&A9', B6: '=1/3&1',
  }], {
    A1: '3.5', A2: '', A3: 't', B1: '3.5t', B2: '0.333333|0',
    B3: '15', B4: '7x', B5: '', B6: '0.3333331',
  }),
  t('compare-text', [{
    A1: 'apple', A2: 'Apple', B1: '=A1>A2', B2: '=A1=A2', B3: '="10"<"9"',
    B4: '="a"<"B"', B5: '="ab"<"abc"', B6: '=A1<>"apple"', B7: '=A3<"a"', B8: '=A3>=A3',
  }], {
    A1: 'apple', A2: 'Apple', B1: '1', B2: '0', B3: '1',
    B4: '0', B5: '1', B6: '0', B7: '1', B8: '1',
  }),
  t('compare-mixed', [{
    A1: '5', A2: 'x', B1: '=A1=A2', B2: '=A2>1', B3: '=A3=0',
    B4: '=A3=A4', B5: '=A2=A3', B6: '=A3<A1', B7: '=1=1.0', B8: '=A3<>A1',
  }], {
    A1: '5', A2: 'x', B1: '#VALUE!', B2: '#VALUE!', B3: '1',
    B4: '1', B5: '0', B6: '1', B7: '1', B8: '1',
  }),
  t('div-zero', [{
    A1: '0', B1: '=5/A1', B2: '=5/A2', B3: '=0/0', B4: '=B1+1',
    B5: '=SUM(B1,2)', B6: '=IF(B1,1,2)', B7: '=1/(A1+1)', B8: '="a"/0',
  }], {
    A1: '0', B1: '#DIV/0!', B2: '#DIV/0!', B3: '#DIV/0!', B4: '#DIV/0!',
    B5: '#DIV/0!', B6: '#DIV/0!', B7: '1', B8: '#VALUE!',
  }),
  t('limit', [{
    A1: '999999999999999', B1: '=A1+1', C1: '=A1+0', D1: '=10^15', E1: '=10^14*9',
    F1: '=SUM(A1,A1)', G1: '=0^-1', H1: '=(-8)^0.5', I1: '=AVG(A1,A1,A1)', J1: '=-A1-1',
    K1: '=1000000*1000000*1000', L1: '=1000000*1000000*999',
  }], {
    A1: '999999999999999', B1: '#VALUE!', C1: '999999999999999', D1: '#VALUE!', E1: '900000000000000',
    F1: '#VALUE!', G1: '#VALUE!', H1: '#VALUE!', I1: '999999999999999', J1: '#VALUE!',
    K1: '#VALUE!', L1: '999000000000000',
  }),
  t('ref-invalid', [{
    A1: '7', B1: '=A0', C1: '=A100', D1: '=A01', E1: '=AB1',
    F1: '=IF(1,2,A0)', G1: '=IF(0,A0,3)', H1: '=A1+B1', I1: '=SUM(A0:B1)', J1: '=a1',
    K1: '=Z99', L1: '=AB12',
  }], {
    A1: '7', B1: '#REF!', C1: '#REF!', D1: '#REF!', E1: '#REF!',
    F1: '2', G1: '3', H1: '#REF!', I1: '#REF!', J1: '#ERR!',
    K1: '0', L1: '#REF!',
  }),
  t('range-order', [{
    A1: '1', B1: '2', A2: '3', B2: '4', C1: '=SUM(B2:A1)',
    C2: '=MAX(B1:A2)', C3: '=COUNT(A1:B3)', C4: '=MIN(A2:A1)', C5: '=SUM(A2:B2)', C6: '=SUM(B2:B1)',
    C7: '=AVG(A1:B2)',
  }], {
    A1: '1', B1: '2', A2: '3', B2: '4', C1: '10',
    C2: '4', C3: '4', C4: '1', C5: '7', C6: '6',
    C7: '2.5',
  }),
  t('range-misuse', [{
    A1: '1', A2: '2', B1: '=A1:A2', B2: '=SUM(A1:A2)+1', B3: '=SUM(A1:A2+1)',
    B4: '=IF(A1:A2,1,2)', B5: '=ABS(A1:A2)', B6: '=ROUND(A1:A2)', B7: '=SUM(A1:A99)', B8: '=SUM(A1:A100)',
    B9: '=NOPE(A1:A2)', B10: '=(A1:A2)',
  }], {
    A1: '1', A2: '2', B1: '#VALUE!', B2: '4', B3: '#VALUE!',
    B4: '#VALUE!', B5: '#VALUE!', B6: '#VALUE!', B7: '3', B8: '#REF!',
    B9: '#NAME?', B10: '#VALUE!',
  }),
  t('agg-scan', [{
    A1: '5', A2: 'text', A3: '', A4: '=A1*2', A5: '=1/0',
    B1: '=SUM(A1:A4)', B2: '=SUM(A1:A5)', B3: '=AVG(A1:A4)', B4: '=AVG(A2:A3)', B5: '=MIN(A2:A3)',
    B6: '=COUNT(A1:A4)', B7: '=MAX(A1:A4,100)', B8: '=COUNT()', B9: '=SUM(A5:A1)', B10: '=MIN(A1:A4,-3)',
    B11: '=MAX(-5,-2)',
  }], {
    A1: '5', A2: 'text', A3: '', A4: '10', A5: '#DIV/0!',
    B1: '15', B2: '#DIV/0!', B3: '7.5', B4: '#DIV/0!', B5: '0',
    B6: '2', B7: '100', B8: '0', B9: '#DIV/0!', B10: '-3',
    B11: '-2',
  }),
  t('agg-direct', [{
    A1: 'x', A2: '', B1: '=SUM(A1)', B2: '=SUM(A2)', B3: '=COUNT(A2,A2)',
    B4: '=SUM(A1:A2,"3")', B5: '=AVG(A2)', B6: '=MAX(-5,A2)', B7: '=MIN(A2,3)', B8: '=COUNT(A2,1,A9)',
    B9: '=SUM(A1:A2,A2)', B10: '=SUM(A1:A2,1/0,"x")',
  }], {
    A1: 'x', A2: '', B1: '#VALUE!', B2: '0', B3: '2',
    B4: '#VALUE!', B5: '0', B6: '0', B7: '0', B8: '3',
    B9: '0', B10: '#DIV/0!',
  }),
  t('if-lazy', [{
    A1: '0', B1: '=IF(A1,1/0,5)', B2: '=IF(A1=0,7,NOPE(1))', B3: '=IF(A1,1)', B4: '=IF("x",1,2)',
    B5: '=IF(1/0,1,2)', B6: '=IF(A9,1,2)', B7: '=IF(1,A1,A2)', B8: '=IF(0,1,"no")&"!"', B9: '=IF(1,2,3,4)',
    B10: '=IF(2,"t","f")', B11: '=IF(0.5,"t","f")',
  }], {
    A1: '0', B1: '5', B2: '7', B3: '#VALUE!', B4: '#VALUE!',
    B5: '#DIV/0!', B6: '2', B7: '0', B8: 'no!', B9: '#VALUE!',
    B10: 't', B11: 't',
  }),
  t('round-rule', [{
    A1: '=ROUND(2.5,0)', A2: '=ROUND(-2.5,0)', A3: '=ROUND(1.5,0)', A4: '=ROUND(-1.5,0)', A5: '=ROUND(0.5,0)',
    A6: '=ROUND(-0.5,0)', A7: '=ROUND(1/3,4)', A8: '=ROUND(5,7)', A9: '=ROUND(5,-1)', A10: '=ROUND(5,1.5)',
    A11: '=ROUND(5)', A12: '=ROUND("a",1)', B1: '=ROUND(1234.5678,3)', B2: '=ROUND(-0.0000004,6)', B3: '=ROUND(A20,A21)',
    B4: '=ROUND(1/0,"x")', B5: '=ROUND("x",1/0)', B6: '=ROUND(7,"a")', B7: '=ROUND(123.456,0)',
  }], {
    A1: '3', A2: '-3', A3: '2', A4: '-2', A5: '1',
    A6: '-1', A7: '0.3333', A8: '#VALUE!', A9: '#VALUE!', A10: '#VALUE!',
    A11: '#VALUE!', A12: '#VALUE!', B1: '1234.568', B2: '0', B3: '0',
    B4: '#DIV/0!', B5: '#DIV/0!', B6: '#VALUE!', B7: '123',
  }),
  t('name-error', [{
    A1: '=FOO(1/0)', B1: '=sum(1)', C1: '=SUM (1)', D1: '=SUM(1,)', E1: '=SUM()',
    F1: '=AVG()', G1: '=MIN()+COUNT()', H1: '=FOO()+1/0', I1: '=ABS(1,2)', J1: '=ABS("a")',
    K1: '=ABS(-2.5)', L1: '=ABS(A9)',
  }], {
    A1: '#NAME?', B1: '#ERR!', C1: '#ERR!', D1: '#ERR!', E1: '0',
    F1: '#DIV/0!', G1: '0', H1: '#NAME?', I1: '#VALUE!', J1: '#VALUE!',
    K1: '2.5', L1: '0',
  }),
  t('syntax-error', [{
    A1: '=', B1: '=1+', C1: '=(1', D1: '=1 2', E1: '=1.',
    F1: '=A', G1: '=A1:', H1: '=SUM(A1:B)', I1: '=1 + * 2', J1: '=#',
    K1: '=2 ^', L1: '=1 <> <> 2', M1: '=+1', N1: '= 1 + 2 ', O1: '=1,2',
    P1: '=1<2<3', Q1: '=A1:B2:C3', R1: '=5%', S1: '=-', T1: '=1 = = 1',
  }], {
    A1: '#ERR!', B1: '#ERR!', C1: '#ERR!', D1: '#ERR!', E1: '#ERR!',
    F1: '#ERR!', G1: '#ERR!', H1: '#ERR!', I1: '#ERR!', J1: '#ERR!',
    K1: '#ERR!', L1: '#ERR!', M1: '#ERR!', N1: '3', O1: '#ERR!',
    P1: '1', Q1: '#ERR!', R1: '#ERR!', S1: '#ERR!', T1: '#ERR!',
  }),
  t('error-order', [{
    A1: '=1/0', B1: '=NOPE(1)', C1: '=A1+B1', D1: '=B1+A1', E1: '="a"+A1',
    F1: '=A1+"a"', G1: '=B1&A1', H1: '=-A1', I1: '=-"x"', J1: '="x"+1/0',
    K1: '=A9+"x"+A1',
  }], {
    A1: '#DIV/0!', B1: '#NAME?', C1: '#DIV/0!', D1: '#NAME?', E1: '#DIV/0!',
    F1: '#DIV/0!', G1: '#NAME?', H1: '#DIV/0!', I1: '#VALUE!', J1: '#DIV/0!',
    K1: '#VALUE!',
  }),
  t('propagation', [{
    A1: '=1/0', B1: '=A1', C1: '=B1+1', D1: '=IF(1,C1,0)', E1: '=IF(0,C1,"fine")',
    F1: '=SUM(A1:C1)', G1: '=ROUND(C1,2)', H1: '=ABS(C1)', I1: '=C1=C1', J1: '=1+',
    K1: '=J1&"x"',
  }], {
    A1: '#DIV/0!', B1: '#DIV/0!', C1: '#DIV/0!', D1: '#DIV/0!', E1: 'fine',
    F1: '#DIV/0!', G1: '#DIV/0!', H1: '#DIV/0!', I1: '#DIV/0!', J1: '#ERR!',
    K1: '#ERR!',
  }),
  t('cycle', [{
    A1: '=B1', B1: '=A1', C1: '=A1+1', D1: '=5', E1: '=E1',
    F1: '=D1+1', G1: '=C1', H1: '=SUM(A1:B1)', I1: '=IF(D1,F1,A1)', J1: '1',
    K1: 'text',
  }], {
    A1: '#CYCLE!', B1: '#CYCLE!', C1: '#CYCLE!', D1: '5', E1: '#CYCLE!',
    F1: '6', G1: '#CYCLE!', H1: '#CYCLE!', I1: '#CYCLE!', J1: '1',
    K1: 'text',
  }),
  t('cycle-static', [{
    A1: '=IF(1,5,A1)', B1: '=IF(0,B2,3)', B2: '=B1', C1: '=NOPE(C2)', C2: '=C1',
    D1: '=SUM(D2:D3)', D2: '1', D3: '=D1', E1: '=A1', F1: '=1/0+F1',
    G1: '=SUM(Z98:Z99)', H1: '=SUM(A0:A1)', I1: '=IF(0,A0,3)',
  }], {
    A1: '#CYCLE!', B1: '#CYCLE!', B2: '#CYCLE!', C1: '#CYCLE!', C2: '#CYCLE!',
    D1: '#CYCLE!', D2: '1', D3: '#CYCLE!', E1: '#CYCLE!', F1: '#CYCLE!',
    G1: '0', H1: '#REF!', I1: '3',
  }),
  t('syntax-error', [{ A1: '=1+', B1: '=A1&"x"', C1: '=C1+A1', D1: '=B1', E1: '=E1+', F1: '=E1' }], { A1: '#ERR!', B1: '#ERR!', C1: '#CYCLE!', D1: '#ERR!', E1: '#ERR!', F1: '#ERR!' }),
  t('memo', [{
    A1: '=A2+A2', A2: '=A3+A3', A3: '=A4+A4', A4: '=A5+A5', A5: '=A6+A6',
    A6: '=A7+A7', A7: '=A8+A8', A8: '=A9+A9', A9: '=A10+A10', A10: '=A11+A11',
    A11: '=A12+A12', A12: '=A13+A13', A13: '=A14+A14', A14: '=A15+A15', A15: '=A16+A16',
    A16: '=A17+A17', A17: '=A18+A18', A18: '=A19+A19', A19: '=A20+A20', A20: '=A21+A21',
    A21: '=A22+A22', A22: '=A23+A23', A23: '=A24+A24', A24: '=A25+A25', A25: '=A26+A26',
    A26: '=A27+A27', A27: '=A28+A28', A28: '=A29+A29', A29: '=A30+A30', A30: '=A31+A31',
    A31: '=A32+A32', A32: '=A33+A33', A33: '=A34+A34', A34: '=A35+A35', A35: '=A36+A36',
    A36: '=A37+A37', A37: '=A38+A38', A38: '=A39+A39', A39: '=A40+A40', A40: '=A41+A41',
    A41: '=A42+A42', A42: '=A43+A43', A43: '=A44+A44', A44: '=A45+A45', A45: '=A46+A46',
    A46: '=A47+A47', A47: '=A48+A48', A48: '1',
  }], {
    A1: '140737488355328', A2: '70368744177664', A3: '35184372088832', A4: '17592186044416', A5: '8796093022208',
    A6: '4398046511104', A7: '2199023255552', A8: '1099511627776', A9: '549755813888', A10: '274877906944',
    A11: '137438953472', A12: '68719476736', A13: '34359738368', A14: '17179869184', A15: '8589934592',
    A16: '4294967296', A17: '2147483648', A18: '1073741824', A19: '536870912', A20: '268435456',
    A21: '134217728', A22: '67108864', A23: '33554432', A24: '16777216', A25: '8388608',
    A26: '4194304', A27: '2097152', A28: '1048576', A29: '524288', A30: '262144',
    A31: '131072', A32: '65536', A33: '32768', A34: '16384', A35: '8192',
    A36: '4096', A37: '2048', A38: '1024', A39: '512', A40: '256',
    A41: '128', A42: '64', A43: '32', A44: '16', A45: '8',
    A46: '4', A47: '2', A48: '1',
  }),
  t('agg-scan', [{
    A1: 'pen', B1: '12', C1: '1.25', D1: '=B1*C1', E1: '=IF(B1=0,"out",IF(D1>100,"big","ok"))',
    A2: 'book', B2: '3', C2: '14.5', D2: '=B2*C2', E2: '=IF(B2=0,"out",IF(D2>100,"big","ok"))',
    A3: 'cable', B3: '0', C3: '7.5', D3: '=B3*C3', E3: '=IF(B3=0,"out",IF(D3>100,"big","ok"))',
    A4: 'desk', B4: '2', C4: '120', D4: '=B4*C4', E4: '=IF(B4=0,"out",IF(D4>100,"big","ok"))',
    A5: 'chair', B5: '', C5: '85.5', D5: '=B5*C5', E5: '=IF(B5=0,"out",IF(D5>100,"big","ok"))',
    D7: '=SUM(D1:D5)', D8: '=ROUND(AVG(D1:D5),1)', D9: '=MAX(D1:D5)&" ("&COUNT(D1:D5)&")"', D10: '=COUNT(B1:B5)', D11: '=D7/B5',
    D12: '=IF(D7>=250,"over","under")',
  }], {
    A1: 'pen', B1: '12', C1: '1.25', D1: '15', E1: 'ok',
    A2: 'book', B2: '3', C2: '14.5', D2: '43.5', E2: 'ok',
    A3: 'cable', B3: '0', C3: '7.5', D3: '0', E3: 'out',
    A4: 'desk', B4: '2', C4: '120', D4: '240', E4: 'big',
    A5: 'chair', B5: '', C5: '85.5', D5: '0', E5: 'out',
    D7: '298.5', D8: '59.7', D9: '240 (5)', D10: '4', D11: '#DIV/0!',
    D12: 'over',
  }),
  t('cycle-static', [{ A1: '1', A5: '=SUM(A1:A9)', B1: '=A5+1', C1: '=SUM(B1:B1)', D1: '=SUM(A1:A2)' }], { A1: '1', A5: '#CYCLE!', B1: '#CYCLE!', C1: '#CYCLE!', D1: '1' }),
  t('limit', [{
    A1: '1000000000000000', B1: '=A1', C1: '=MAX(A1)', D1: '=MIN(A1,2)', E1: '=A1+0',
    F1: '=SUM(A1)', G1: '=ABS(A1)', H1: '=ROUND(A1,0)', I1: '=A1&"x"', J1: '99999999999999999999',
  }], {
    A1: '1000000000000000', B1: '1000000000000000', C1: '1000000000000000', D1: '2', E1: '#VALUE!',
    F1: '#VALUE!', G1: '1000000000000000', H1: '1000000000000000', I1: '1000000000000000x', J1: '100000000000000000000',
  }),
  t('agg-scan', [{ A1: '1', B1: '=1/0', A2: '=NOPE(1)', B2: '2', C1: '=SUM(A1:B2)', C2: '=COUNT(B2:A1)' }], { A1: '1', B1: '#DIV/0!', A2: '#NAME?', B2: '2', C1: '#DIV/0!', C2: '#DIV/0!' }),
  t('syntax-error', [{ A1: '=A1B2', B1: '=A1.5', C1: '=.5', D1: '=1E3', E1: '="a" "b"', F1: '=FOO', G1: '=FOO1' }], { A1: '#ERR!', B1: '#ERR!', C1: '#ERR!', D1: '#ERR!', E1: '#ERR!', F1: '#ERR!', G1: '#REF!' }),
  t('display-format', [{ A1: '=-1/3', A2: '=-7/2', A3: '=10^-2', A4: '=A9^2', A5: '=0.1+0.2&""', A6: '=4^0.5' }], { A1: '-0.333333', A2: '-3.5', A3: '0.01', A4: '0', A5: '0.3', A6: '2' }),
  t('concat', [{ A1: '007', B1: '=A1&"|"' }], { A1: '7', B1: '7|' }),
];

// Tests whose expected value is computed from the reference solution when generate.mjs runs.
// A computed test with the same arguments as a hand-derived one is dropped.
const computed = [
    t('cell-kinds', [{ A1: '12', A2: '-3', A3: '007', A4: '2.50', A5: ' 5', A6: '1e3', A7: '+4', A8: '.5', A9: '5.', A10: 'hello', A11: '', A12: '-', A13: '3.14159265', A14: '1000000.1234567', A15: '--1', A16: '1 2' }]),
    t('display-format', [{ A1: '=1/3', A2: '=2/3', A3: '=10/4', A4: '=-1/3000000', A5: '=0.1+0.2', A6: '=100', A7: '=1/8', A8: '=7/1000000', A9: '=5000000.5', A10: '=-7/2', A11: '=1000000*1000', A12: '=0.0000004' }]),
    t('formula-blank', [{ A1: '', B1: '=A1', C1: '=A1+A2', D1: '=A1&"x"', E1: '=IF(A1,1,2)', F1: '=A1=0', G1: '=A1=""', H1: '=-A1', I1: '=A9' }]),
    t('pow-left', [{ A1: '=2^3^2', B1: '=-2^2', C1: '=2^-1', D1: '=-2^-2', E1: '=2*3^2', F1: '=-3*-3', G1: '=2^0.5*2^0.5', H1: '=4^3^0.5' }]),
    t('neg-tighter', [{ A1: '3', B1: '=-A1^2', C1: '=0-A1^2', D1: '=-(A1^2)', E1: '=2-3^2', F1: '=-A1^-A1', G1: '=--A1', H1: '=1--1' }]),
    t('precedence', [{ A1: '=1+2*3-4/2', B1: '=(1+2)*3', C1: '="a"&1+2&"b"', D1: '=1<2=1', E1: '=1+1=2&"x"', F1: '=2>1+1', G1: '=2*3&4*5', H1: '=10-4-3', I1: '=100/10/5', J1: '=1&2=12' }]),
    t('string-escape', [{ A1: '="say ""hi"""', B1: '=""&"x"', C1: '="a""b"&A1', D1: '="abc', E1: '="" = ""', F1: '="""', G1: '="a"&""""&"b"' }]),
    t('concat', [{ A1: '3.5', A2: '', A3: 't', B1: '=A1&A2&A3', B2: '=A2&A2', B3: '=1/3&"|"&-0', B4: '=A1&A5', B5: '=1&2+3', B6: '=A1*2&"x"' }]),
    t('compare-text', [{ A1: 'apple', A2: 'Apple', B1: '=A1>A2', B2: '=A1=A2', B3: '=A2<"b"', B4: '=A1<>"apple"', B5: '="a"<"B"', B6: '="10"<"9"', B7: '="abc"<"abd"', B8: '="ab"<"abc"' }]),
    t('compare-mixed', [{ A1: '5', A2: 'x', B1: '=A1=A2', B2: '=A2>1', B3: '=A3=""', B4: '=A3=0', B5: '=A3=A4', B6: '=A2=A3', B7: '=A2<A3', B8: '=1=1.0', B9: '=A3<>A1' }]),
    t('div-zero', [{ A1: '0', B1: '=5/A1', B2: '=5/A2', B3: '=0/0', B4: '=B1+1', B5: '=SUM(B1,2)', B6: '=IF(B1,1,2)', B7: '=1/(A1+1)' }]),
    t('limit', [{ A1: '999999999999999', B1: '=A1+1', C1: '=A1+0', D1: '=10^15', E1: '=10^14*9.99999', F1: '=SUM(A1,A1)', G1: '=0^-1', H1: '=(-8)^0.5', I1: '=AVG(A1,A1,A1)', J1: '=-A1-1' }]),
    t('ref-invalid', [{ A1: '7', B1: '=A0', C1: '=A100', D1: '=A01', E1: '=AB1', F1: '=IF(1,2,A0)', G1: '=Z99+1', H1: '=a1', I1: '=A1+B1', J1: '=SUM(A0:B1)' }]),
    t('range-order', [{ A1: '1', B1: '2', A2: '3', B2: '4', C1: '=SUM(B2:A1)', C2: '=SUM(A1:B2)', C3: '=MAX(B1:A2)', C4: '=COUNT(A1:B3)', C5: '=SUM(A2:A1)', C6: '=MIN(B2:B1,A9:A9)' }]),
    t('range-misuse', [{ A1: '1', A2: '2', B1: '=A1:A2', B2: '=SUM(A1:A2)+1', B3: '=SUM(A1:A2+1)', B4: '=IF(A1:A2,1,2)', B5: '=ABS(A1:A2)', B6: '=NOPE(A1:A2)', B7: '=SUM(A1:A99,A1:B0)', B8: '=ROUND(A1:A2)', B9: '=(A1:A2)' }]),
    t('agg-scan', [{ A1: '5', A2: 'text', A3: '', A4: '=A1*2', A5: '=1/0', B1: '=SUM(A1:A4)', B2: '=SUM(A1:A5)', B3: '=AVG(A1:A4)', B4: '=AVG(A2:A3)', B5: '=MIN(A2:A3)', B6: '=COUNT(A1:A4)', B7: '=MAX(A1:A4,100)', B8: '=COUNT()', B9: '=SUM(A5:A1)' }]),
    t('agg-direct', [{ A1: 'x', A2: '', B1: '=SUM(A1)', B2: '=SUM(A2)', B3: '=COUNT(A2,A2)', B4: '=SUM(A1:A2,"3")', B5: '=AVG(A2)', B6: '=MAX(-5,A2)', B7: '=MIN(A2,3)', B8: '=COUNT(A2,1,A9)', B9: '=SUM(A1:A2,A2)' }]),
    t('if-lazy', [{ A1: '0', B1: '=IF(A1,1/0,5)', B2: '=IF(A1=0,7,NOPE(1))', B3: '=IF(A1,1)', B4: '=IF("x",1,2)', B5: '=IF(1/0,1,2)', B6: '=IF(A9,1,2)', B7: '=IF(1,A1,A2)', B8: '=IF(0,1,"no")&"!"', B9: '=IF(1,2,3,4)' }]),
    t('round-rule', [{ A1: '=ROUND(2.5,0)', A2: '=ROUND(-2.5,0)', A3: '=ROUND(2.675,2)', A4: '=ROUND(1/3,4)', A5: '=ROUND(5,7)', A6: '=ROUND(5,-1)', A7: '=ROUND(5,1.5)', A8: '=ROUND(5)', A9: '=ROUND("a",1)', B1: '=ROUND(1234.5678,3)+ROUND(-0.0000004,6)', B2: '=ROUND(A20,A21)', B3: '=ROUND(1/0,"x")', B4: '=ROUND("x",1/0)' }]),
    t('name-error', [{ A1: '=FOO(1/0)', B1: '=sum(1)', C1: '=SUM (1)', D1: '=SUM(1,)', E1: '=SUM()', F1: '=AVG()', G1: '=MIN()+COUNT()', H1: '=FOO()+1/0', I1: '=ABS(1,2)', J1: '=ABS("a")', K1: '=ABS(-2.5)' }]),
    t('syntax-error', [{ A1: '=', B1: '=1+', C1: '=(1', D1: '=1 2', E1: '=1.', F1: '=A', G1: '=A1:', H1: '=SUM(A1:B)', I1: '=1 + * 2', J1: '=#', K1: '=2 ^', L1: '=1 <> <> 2', M1: '=A1 A2', N1: '=)', O1: '=1,2', P1: '=+1', Q1: '= 1 + 2 ' }]),
    t('error-order', [{ A1: '=1/0', B1: '=NOPE(1)+1', C1: '=A1+B1', D1: '=B1+A1', E1: '="a"+A1', F1: '=A1+"a"', G1: '=B1&A1', H1: '=-A1', I1: '=-"x"', J1: '="x"+1/0', K1: '=A9+"x"+A1' }]),
    t('propagation', [{ A1: '=1/0', B1: '=A1', C1: '=B1+1', D1: '=IF(1,C1,0)', E1: '=IF(0,C1,"fine")', F1: '=SUM(A1:C1)', G1: '=ROUND(C1,2)', H1: '=ABS(C1)', I1: '=C1=C1', J1: '=1+', K1: '=J1&"x"' }]),
    t('cycle', [{ A1: '=B1', B1: '=A1', C1: '=A1+1', D1: '=5', E1: '=E1', F1: '=D1+1', G1: '=C1', H1: '=SUM(A1:B1)', I1: '=IF(D1,F1,A1)' }]),
    t('cycle-static', [{ A1: '=IF(1,5,A1)', B1: '=IF(0,B2,3)', B2: '=B1', C1: '=NOPE(C2)', C2: '=C1', D1: '=SUM(D2:D3)', D2: '1', D3: '=D1', E1: '=A1', F1: '=1/0+F1', G1: '=SUM(Z98:Z99)', H1: '=SUM(A0:A1)' }]),
    t('cycle', [{ A1: '=1+', B1: '=A1&"x"', C1: '=C1+A1', D1: '=B1', E1: '=A1+', F1: '=E1' }]),
    t('syntax-error', [{ A1: '=A1+', B1: '=A1', C1: '=C2', C2: '=1', D1: '=(D1' }]),
    t('memo', [chain(40)]),
    t('memo', [{ A1: '=B1+B1', B1: '=C1+C1', C1: '=D1+D1', D1: '=SUM(E1:E3)+SUM(E1:E3)', E1: '1', E2: '=E1+E1', E3: '=E2+E2', F1: '=A1+B1+C1+D1', G1: '=SUM(A1:F1)' }]),
    t('precedence', [invoice()]),
    t('cell-kinds', [{ A1: '=1', Z99: '5', M50: '=Z99*2', B2: '"quoted"', C3: "=B2&'x'", D4: '=B2&"!"', A99: '=Z99+A1', Z1: '=A99/4', A50: 'Name: Z1' }]),
];
const argsKey = (test) => JSON.stringify(test.args);
const handKeys = new Set(hand.map(argsKey));

export default {
  slug: 'sheet-engine',
  tier: {
    level: 5,
    human_minutes: 160,
    basis: 'A formula tokenizer and parser with unusual precedence (Excel-style ^ and minus), an evaluator with exact coercion, error-order and range rules, static cycle detection and memoised evaluation. About 40 stated rules; the reference is about 330 lines. An expert needs about 2.5 to 3 h to read, implement and debug it.',
  },
  tags: ['spec'],
  name: 'evaluateSheet',
  signature: 'evaluateSheet(cells) -> object',
  task: spec,
  edges: {
    'cell-kinds': 'any other string is a text cell',
    'display-format': 'trailing zeros after the decimal point removed',
    'formula-blank': 'the cell holds the number 0 instead',
    'pow-left': '2^3^2 is (2^3)^2 = 64',
    'neg-tighter': '-2^2 is (-2)^2 = 4',
    precedence: 'from the loosest to the tightest',
    'string-escape': 'two double quotes inside stand for one quote character',
    concat: 'a blank becomes the empty text',
    'compare-text': 'compared by character code, case-sensitive',
    'compare-mixed': 'a text compared with a number gives #value!',
    'div-zero': 'division by 0 gives #div/0!',
    limit: 'absolute value of 10^15 or more',
    'ref-invalid': 'an invalid cell id',
    'range-order': 'whichever corner is written first',
    'range-misuse': 'a range gives #value! when it is evaluated anywhere except',
    'agg-scan': 'a blank or text is skipped',
    'agg-direct': 'a blank is collected as 0',
    'if-lazy': 'only the chosen one of a and b is evaluated',
    'round-rule': 'math.sign(x) * math.round(math.abs(x) * 10 ** d) / 10 ** d',
    'name-error': 'any other name gives #name?',
    'syntax-error': 'the cell shows #err!',
    'error-order': 'if the left operand is an error',
    propagation: 'a reference to a cell whose value is an error gives that error',
    cycle: 'shows #cycle! whatever its content is',
    'cycle-static': 'branches of if that are not chosen',
    memo: 'must not be computed again for each use of it',
  },
  tests: [...hand, ...computed.filter((test) => !handKeys.has(argsKey(test)))],
};
