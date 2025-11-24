// bin/infrastructure/configLoader.js

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

/**
 * Tabla de archivos que el CLI reconoce como configuraciones.
 * Ninguno es obligatorio en este nivel.
 *
 * Cada feature valida que SU configuración exista.
 */
const CONFIG_FILES = {
  modularize: "config/modularize.yaml",
  bundle: "config/bundle.yaml",
  normalize: "config/normalize.yaml",
  linter: "config/linter.yaml",
  logging: "config/logging.yaml",
};

/**
 * Carga un archivo YAML si existe.
 * 
 * Nunca lanza error aquí.
 * Si el archivo no existe → retorna null.
 */
function loadYamlConfig(relativePath) {
  const filePath = path.resolve(process.cwd(), relativePath);

  if (!fs.existsSync(filePath)) {
    return null; // El application-layer decidirá si esto es un error.
  }

  const raw = fs.readFileSync(filePath, "utf8");

  try {
    return yaml.load(raw);
  } catch (err) {
    throw new Error(`❌ Error parseando YAML en ${relativePath}: ${err.message}`);
  }
}

/**
 * Carga TODOS los archivos YAML mapeados en CONFIG_FILES.
 * 
 * Retorna un objeto como:
 * {
 *   modularize: {...} || null,
 *   bundle: {...} || null,
 *   normalize: {...} || null,
 *   linter: {...} || null,
 *   logging: {...} || null,
 * }
 */
function loadAllConfigs() {
  const configs = {};

  for (const [key, file] of Object.entries(CONFIG_FILES)) {
    configs[key] = loadYamlConfig(file);
  }

  return configs;
}

module.exports = {
  loadAllConfigs,
  loadYamlConfig,
};
