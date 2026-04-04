module.exports = function(eleventyConfig) {
  // Pass through static files
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy("styles.css");
  eleventyConfig.addPassthroughCopy("iframe.css");
  eleventyConfig.addPassthroughCopy("iframe.html");
  eleventyConfig.addPassthroughCopy("games-loader.js");
  eleventyConfig.addPassthroughCopy("credits.txt");

  // Make data available globally
  eleventyConfig.addGlobalData("baseUrls", require("./_data/baseUrls.json"));

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "../_includes",
      layouts: "../_layouts",
      data: "../_data"
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk"
  };
};
