import { replaceSmilies } from "./replace-emoji-in-comments.js";

const cases = [
  {
    in: "hello ![](/assets/images/smilies/icon_wink.gif) world",
    out: "hello 😉 world"
  },
  {
    in: 'img: <img src="/assets/images/smilies/icon_lol.gif" /> haha',
    out: "img: 😂 haha"
  },
  {
    in: 'mixed ![x](/assets/images/smilies/icon_smile.gif) and <img src="/assets/images/smilies/icon_star.gif">',
    out: "mixed 🙂 and ⭐️"
  },
  {
    in: "no change here",
    out: "no change here"
  }
];

let failed = 0;
for (const c of cases) {
  const got = replaceSmilies(c.in);
  const ok = got === c.out;
  console.log(ok ? "OK" : "FAIL", `in=${c.in}`, `got=${got}`);
  if (!ok) failed++;
}

if (failed) {
  console.error(`${failed} tests failed`);
  process.exit(1);
} else {
  console.log("All tests passed");
}
