/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./chat.html", "./options.html"],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/forms")],
};
