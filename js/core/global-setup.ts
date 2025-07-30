// global-setup.ts
import { writeFileSync } from "fs";

async function globalSetup() {
  // Generate test harness HTML
  const harness = `
<!DOCTYPE html>
<html>
<head>
    <script type="module">
      import { tests } from './dist/test/browser.js';
      console.log('hello!');
      tests();
    </script>
</head>
<body></body>
</html>`;

  writeFileSync("./test-harness.html", harness);
  console.log("Test harness created");
}

export default globalSetup;
