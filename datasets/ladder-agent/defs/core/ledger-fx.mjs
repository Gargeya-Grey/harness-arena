export default {
  slug: "ledger-fx",
  tier: {
    level: 3,
    human_minutes: 25,
    basis: "Money rounding and allocation across 6 of 11 files; reference rewrites about 240 lines. About 8 min to read, then 7 rules to restore with a re-check of the arithmetic.",
    origin: "agentic-hard-ledger-fx",
  },
  tags: ["bugfix"],
  task: "We added yen and Kuwaiti dinar accounts and the books stopped adding up. Moving money between a USD account and a JPY account gives amounts that are off by a factor of 100, and USD to KWD is off by a factor of 10. Between two-decimal currencies, converted amounts are sometimes one cent away from our spreadsheet, mostly for negative amounts, for exact half-cent cases and for cross rates that go through USD. Splitting a payment between three people leaves one cent unassigned. Our net worth figure changes with the number of accounts the money is spread over. A small negative amount on a statement loses its minus sign (-0.05 prints as 0.05). Percentage fees come out a unit short whenever the exact fee is half a unit or more.\n\nThe rules we agreed on: money is integer minor units and never goes through binary floating point. Rounding is half away from zero, and it happens once, on the final value, never on an intermediate one. A split gives away exactly the amount it is given: each payee gets the rounded-down share, the leftover units go one each to the largest remainders, the earlier payee wins a tie, and the weights must be non-negative integers that add up to more than zero. A negative total is split like its absolute value, and each share then gets the minus sign (so -100 over three equal weights gives -34, -33, -33). Net worth converts the total of each currency once, rounds each converted total like any other conversion, then adds them. rate() must keep returning a plain number, and the public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.",
};
