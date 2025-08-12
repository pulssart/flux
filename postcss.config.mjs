import tailwindcss from "@tailwindcss/postcss";

export default {
  // Utiliser la fonction du plugin (évite l'erreur "plugin must export a function")
  plugins: [tailwindcss()],
};
