const { getAverageColor } = require("fast-average-color-node");
const fs = require("fs");
const path = require("path");

function extractPath(path = "") {
  const split = path.split("/");
  split.pop();
  return split.join("/");
}

const root = extractPath(process.argv[1]);

async function asyncMap(
  callback = function (item, index, original) {
    return item;
  },
  array = [],
  size = 10
) {
  if (
    typeof callback !== "function" ||
    !Array.isArray(array) ||
    !array.length ||
    size <= 0 ||
    array.length < size
  )
    throw new Error(
      "Invalid call to asyncMap, it expects a function, an array and a size smaller than array length!"
    );

  const batches = array.reduce((batch, item, index) => {
    if (!(index % size)) batch.push([item]);
    else batch[Math.floor(index / size)].push(item);
    return batch;
  }, []);

  for (let i = 0; i < batches.length; i++) {
    console.log(`Processing async batch ${i}...`);
    batches[i] = await Promise.all(batches[i].map(callback));
    console.log(`Processed batch ${i}!`);
  }

  return batches.reduce((resolved, batch) => [...resolved, ...batch], []);
}

function r(color = []) {
  return color[0];
}
function g(color = []) {
  return color[1];
}
function b(color = []) {
  return color[2];
}
function a(color = []) {
  return color[3];
}

function rgb(color) {
  return [r(color), g(color), b(color)];
}

function convertAverage(color = []) {
  return color.reduce((acc, val) => acc + val, 0);
}

function colorValue(color = { value: "" }) {
  return color.value;
}

// function sum(...nums) {
//   return nums.reduce((acc, val) => acc + val, 0);
// }

// https://en.wikipedia.org/wiki/Color_difference

function colorDelta(colorA, colorB, transformer) {
  return transformer(colorB) - transformer(colorA);
}

function distance(colorA, colorB) {
  return Math.sqrt(
    colorDelta(colorA, colorB, r) ** 2 +
      colorDelta(colorA, colorB, g) ** 2 +
      colorDelta(colorA, colorB, b) ** 2
  );
}

function humanDistance(colorA, colorB) {
  const multiplier =
    Math.sqrt(colorDelta(colorA, colorB, r) ** 2) < 128 ? 2 : 3;

  return Math.sqrt(
    multiplier * colorDelta(colorA, colorB, r) ** 2 +
      4 * colorDelta(colorA, colorB, g) ** 2 +
      (multiplier === 2 ? 3 : 2) * colorDelta(colorA, colorB, b) ** 2
  );
}

function redMean(colorA, colorB) {
  const rDist = (r(colorA) + r(colorB)) / 2;

  return Math.sqrt(
    (2 + rDist / 256) * colorDelta(colorA, colorB, r) ** 2 +
      4 * colorDelta(colorA, colorB, g) ** 2 +
      (2 + (255 - rDist) / 2) * colorDelta(colorA, colorB, b) ** 2
  );
}

// <3 https://medium.com/@dtipson/creating-an-es6ish-compose-in-javascript-ac580b95104a
function compose(...fns) {
  return fns.reduce((f, g) => (...args) => f(g(...args)));
}

const white = Array(3).fill(225);

const CRITERIA = {
  light: "light",
  lightNA: "light-na",
  r: "r",
  g: "g",
  b: "b",
  a: "a",
  srgb: "srgb",
  srgbH: "srgb-h",
  srgbR: "srgb-r",
};

const SORT_CRITERIA = {
  [CRITERIA.light]: compose(convertAverage, colorValue),
  [CRITERIA.lightNA]: compose(convertAverage, rgb, colorValue),
  [CRITERIA.r]: compose(r, colorValue),
  [CRITERIA.g]: compose(g, colorValue),
  [CRITERIA.b]: compose(b, colorValue),
  [CRITERIA.a]: compose(a, colorValue),
  [CRITERIA.srgb](reference = white) {
    return (color) => distance(colorValue(color), reference);
  },
  [CRITERIA.srgbH](reference = white) {
    return (color) => humanDistance(colorValue(color), reference);
  },
  [CRITERIA.srgbR](reference = white) {
    return (color) => redMean(colorValue(color), reference);
  },
};

const argv = require("yargs")
  .scriptName("color-sort")
  .usage("Use this to sort files in a specific directory")
  .options({
    c: {
      alias: "color",
      desc:
      "[r g b] (separated by spaces): color to compare value to if using sRGB sorting criteria",
      type: "array",
      default: white,
    },
    e: {
      alias: "ext",
      desc:
      "extensions of the files, separated by a string and without a . in their name",
      default: ["jpg"],
      type: "array",
    },
    i: {
      alias: "input",
      desc: "input folder",
      default: root,
      type: "string",
    },
    o: {
      alias: "output",
      desc: "output folder",
      default: `${root}/sorted`,
      type: "string",
    },
    q: {
      alias: "quantity",
      desc: "Amount of images to process per batch simultaneously",
      default: 10,
      type: "number",
    },
    r: {
      alias: "reverse",
      desc: "reverse sorting order",
      type: "boolean",
      default: false,
    },
    s: {
      alias: "sorter",
      desc: "Criteria to use for sorting the colors",
      choices: Object.values(CRITERIA),
      default: CRITERIA.light,
      type: "string",
    },
  })
  .help().argv;

function getImageAverageColor(image = "") {
  return getAverageColor(`${argv.i}/${image}`);
}

async function getAverageColorArray(array = []) {
  const mappedColors = await asyncMap(getImageAverageColor, array, argv.q);
  return mappedColors.map((colors, index) => ({
    colors,
    extension: path.extname(array[index]),
    name: array[index],
  }));
}

try {
  const files = fs.readdirSync(argv.i);
  console.log("Opening files in %s", argv.i);

  const extensions = argv.e.map((extension) => `.${extension.toLowerCase()}`);
  console.log("Extensions:", extensions);

  const filesByTypes = files.filter((file) =>
    extensions.includes(path.extname(file).toLowerCase())
  );

  if (filesByTypes.length) {
    console.log("Files to be processed:", filesByTypes);

    async function sortAverageColorArray(array = []) {
      const sRGB = [CRITERIA.srgb, CRITERIA.srgbH, CRITERIA.srgbR].includes(
        argv.s
      );
      const sorter = sRGB
        ? SORT_CRITERIA[argv.s](argv.c.map((c) => Number(c)))
        : SORT_CRITERIA[argv.s];
      console.log("Sorting by: %s", argv.s);
      const averageColorArray = await getAverageColorArray(array);
      const sorted = [...averageColorArray].sort(
        (imageA, imageB) => sorter(imageA.colors) - sorter(imageB.colors)
      );
      if (argv.r) sorted.reverse();
      console.log("Average colors:", averageColorArray);
      console.log("Sorted array:", sorted);
      console.log("Copying files to %s", argv.o);

      try {
        const output = await fs.promises.stat(path.resolve(argv.o));
        if (!output.isDirectory())
          throw new Error(
            "This is not a directory, creating a directory with the same name"
          );
      } catch (error) {
        console.log(`Output directory doesn't exist, creating ${argv.o}`);
        await fs.promises.mkdir(path.resolve(argv.o));
      }

      await Promise.all(
        sorted.map(({ name, extension }, index) =>
          fs.promises.copyFile(
            `${path.resolve(argv.i)}/${name}`,
            `${path.resolve(argv.o)}/${index}${extension}`
          )
        )
      );
      console.log("All done! Processed %d images!", sorted.length);
    }

    sortAverageColorArray(filesByTypes);
  } else console.log("No files to process!");
} catch (error) {
  console.log(error);
}
