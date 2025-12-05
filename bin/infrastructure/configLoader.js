// bin/infrastructure/configLoader.js

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Archivos de config soportados
const CONFIG_FILES = {
  modularize: "config/modularize.yaml",
  bundle: "config/bundle.yaml",
  swagger2: "config/swagger2.yaml",
  normalize: "config/normalize.yaml",
  linter: "config/linter.yaml",
  logging: "config/logging.yaml",
  scaffoldings: "config/scaffoldings.yaml", // 👈 NUEVO: definición de estilos / scaffoldings
};

/**
 * Resuelve la ruta real de un archivo de configuración.
 *
 * 1) Primero busca en el proyecto del usuario (process.cwd()):
 *    ./config/xxx.yaml
 *
 * 2) Si no existe, busca dentro del propio paquete CLI:
 *    <raíz-del-paquete>/config/xxx.yaml
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
    swagger2: loadYamlConfig(CONFIG_FILES.swagger2),
    normalize: loadYamlConfig(CONFIG_FILES.normalize),
    linter: loadYamlConfig(CONFIG_FILES.linter),
    logging: loadYamlConfig(CONFIG_FILES.logging),
    scaffoldings: loadYamlConfig(CONFIG_FILES.scaffoldings), // 👈 NUEVO: estilos / scaffoldings
  };
}

module.exports = {
  loadAllConfigs,
  loadYamlConfig,
};
