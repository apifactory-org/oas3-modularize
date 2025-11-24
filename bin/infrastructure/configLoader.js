// bin/infrastructure/configLoader.js

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Archivos de config soportados
const CONFIG_FILES = {
  modularize: "config/modularize.yaml",
  bundle: "config/bundle.yaml",
  normalize: "config/normalize.yaml",
  linter: "config/linter.yaml",
  logging: "config/logging.yaml",
};

/**
 * Resuelve la ruta real de un archivo de configuración.
 *
 * 1) Primero busca en el proyecto del usuario (process.cwd()):
 *    ./config/xxx.yaml
 *
 * 2) Si no existe, busca dentro del propio paquete CLI:
 *    <node_modules>/@apifactory/oas3-modularize/config/xxx.yaml
 *
 * 3) Si tampoco existe, devuelve null.
 */
function resolveConfigPath(relativePath) {
  // 1) Proyecto del usuario
  const fromCwd = path.resolve(process.cwd(), relativePath);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }

  // 2) Carpeta raíz del paquete CLI
  // Este archivo está en: bin/infrastructure/configLoader.js
  // → raíz del paquete = dos niveles arriba
  const moduleRoot = path.resolve(__dirname, "..", "..");
  const fromModule = path.resolve(moduleRoot, relativePath);
  if (fs.existsSync(fromModule)) {
    return fromModule;
  }

  return null;
}

/**
 * Carga un YAML de configuración desde la ruta lógica (relativePath),
 * usando la resolución descrita en resolveConfigPath.
 *
 * @param {string} relativePath  Ruta relativa tipo "config/modularize.yaml"
 * @returns {any|null}
 */
function loadYamlConfig(relativePath) {
  const filePath = resolveConfigPath(relativePath);
  if (!filePath) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  return yaml.load(raw);
}

/**
 * Carga todos los archivos de configuración conocidos.
 *
 * - Si un archivo no existe ni en el proyecto ni en el paquete,
 *   se deja en null para que la capa de aplicación decida qué hacer.
 */
function loadAllConfigs() {
  return {
    modularize: loadYamlConfig(CONFIG_FILES.modularize),
    bundle: loadYamlConfig(CONFIG_FILES.bundle),
    normalize: loadYamlConfig(CONFIG_FILES.normalize),
    linter: loadYamlConfig(CONFIG_FILES.linter),
    logging: loadYamlConfig(CONFIG_FILES.logging),
  };
}

module.exports = {
  loadAllConfigs,
  loadYamlConfig,
};
