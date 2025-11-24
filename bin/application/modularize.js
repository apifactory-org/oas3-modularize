// bin/application/modularize.js

const path = require('path');
const chalk = require('chalk');

const { readYamlFile, writeYamlFile } = require('../infrastructure/yamlUtils');
const { removeDirIfExists, ensureDir, fileExists } = require('../infrastructure/fileSystem');
const { slugifyPath } = require('../core/slugifyPath');
const { fixRefs } = require('../core/fixRefs');
const { validateWithRedocly } = require('./validate');
const { loadAllConfigs } = require('../infrastructure/configLoader');

/**
 * -----------------------------------------------------------
 * ACLARACIÓN IMPORTANTE SOBRE CONFIG vs INPUT/FLAGS
 * -----------------------------------------------------------
 *
 * Todos los valores cargados desde config/modularize.yaml son:
 *    ✔ placeholders
 *    ✔ ejemplos
 *    ✔ valores sugeridos por defecto para el menú interactivo
 *
 * El usuario SIEMPRE puede reemplazarlos mediante:
 *    👉 CLI flags (p. ej. --build ./mi-api.yaml)
 *    👉 input del menú interactivo
 *
 * PRIORIDAD DE VALORES:
 *    1) Entrada del usuario por CLI
 *    2) Entrada del usuario por menú interactivo
 *    3) Valor del archivo config/modularize.yaml
 *
 * Si un valor es obligatorio pero:
 *    - no lo pasa el usuario
 *    - y no existe en config
 *
 * → se lanza un error claro, explícito y obligatorio.
 *
 * NO EXISTEN DEFAULTS OCULTOS NI HARDCODEADOS.
 * Solo se usan valores explícitos del usuario o del config.
 */

// ---------------------------------------------------------------------------
// CARGA DE CONFIGURACIÓN
// ---------------------------------------------------------------------------

const configs = loadAllConfigs();
const modularizeConfig = configs.modularize;

if (!modularizeConfig) {
  throw new Error('❌ No existe archivo de configuración: config/modularize.yaml');
}

if (!modularizeConfig.paths) {
  throw new Error('❌ FALTA config.modularize.paths en config/modularize.yaml');
}

if (!modularizeConfig.behavior) {
  throw new Error('❌ FALTA config.modularize.behavior en config/modularize.yaml');
}

if (!modularizeConfig.advanced) {
  throw new Error('❌ FALTA config.modularize.advanced en config/modularize.yaml');
}

const pathsConfig = modularizeConfig.paths;
const behaviorConfig = modularizeConfig.behavior;
const modularizationConfig = modularizeConfig.modularization || {};
const advancedConfig = modularizeConfig.advanced;

// =====================
// Validaciones estrictas
// =====================

// input
const DEFAULT_INPUT = pathsConfig.input;
if (!DEFAULT_INPUT || typeof DEFAULT_INPUT !== 'string') {
  throw new Error('❌ FALTA o inválido: config.modularize.paths.input (string requerido)');
}

// output base
const TARGET_DIR = pathsConfig.modularizedOutput;
if (!TARGET_DIR || typeof TARGET_DIR !== 'string') {
  throw new Error('❌ FALTA o inválido: config.modularize.paths.modularizedOutput (string requerido)');
}

const NORMALIZED_TARGET_DIR = path.normalize(TARGET_DIR);

// subcarpetas
const COMPONENTS_DIR = path.join(NORMALIZED_TARGET_DIR, 'components');
const PATHS_DIR = path.join(NORMALIZED_TARGET_DIR, 'paths');

// extensión
const FILE_EXTENSION = advancedConfig.fileExtension;
if (!FILE_EXTENSION || typeof FILE_EXTENSION !== 'string') {
  throw new Error(
    '❌ FALTA o inválido: config.modularize.advanced.fileExtension (string requerido, ej: ".yaml")'
  );
}

// entrypoint modular
const MAIN_FILE = path.join(NORMALIZED_TARGET_DIR, `openapi${FILE_EXTENSION}`);

// comportamiento
if (typeof behaviorConfig.cleanModularizedOutput !== 'boolean') {
  throw new Error(
    '❌ FALTA o inválido: config.modularize.behavior.cleanModularizedOutput (boolean requerido)'
  );
}
const CLEAN_MOD_OUTPUT = behaviorConfig.cleanModularizedOutput;

if (typeof behaviorConfig.fixRefs !== 'boolean') {
  throw new Error(
    '❌ FALTA o inválido: config.modularize.behavior.fixRefs (boolean requerido)'
  );
}
const FIX_REFS = behaviorConfig.fixRefs;

// ---------------------------------------------------------------------------
// Validación del campo openapi
// ---------------------------------------------------------------------------
function assertValidOpenApiVersion(value) {
  if (typeof value !== 'string') {
    throw new Error(`"openapi" debe ser un string (ej: "3.0.1"). Valor actual: ${JSON.stringify(value)}`);
  }

  const re = /^3\.\d+(\.\d+)?$/;
  if (!re.test(value.trim())) {
    throw new Error(
      `Valor inválido para "openapi": "${value}". Debe ser similar a "3.0.1" o "3.1.0".`
    );
  }
}

// ---------------------------------------------------------------------------
// Lógica principal de modularización
// ---------------------------------------------------------------------------

async function modularize(inputPathFromCli) {
  // CLI → si el usuario pasa --build, prioriza ese valor
  // sino → usa el placeholder del config
  const inputPath = inputPathFromCli || DEFAULT_INPUT;

  console.log(chalk.blue('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.blue(`🚀 Iniciando modularización de: ${inputPath}`));
  console.log(chalk.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  try {
    if (!fileExists(inputPath)) {
      throw new Error(`El archivo de entrada no existe: ${inputPath}`);
    }

    const oasData = readYamlFile(inputPath);

    assertValidOpenApiVersion(oasData.openapi);

    // limpiar si está habilitado
    if (CLEAN_MOD_OUTPUT) {
      removeDirIfExists(NORMALIZED_TARGET_DIR);
    }

    ensureDir(COMPONENTS_DIR);
    ensureDir(PATHS_DIR);
    console.log(chalk.green(`✔ Directorios preparados en: ${NORMALIZED_TARGET_DIR}`));

    // entrypoint modular
    const newOas = {
      openapi: oasData.openapi,
      info: oasData.info,
      servers: oasData.servers || [],
      tags: oasData.tags || [],
      security: oasData.security || [],
      externalDocs: oasData.externalDocs || undefined,
      paths: {},
      components: {},
    };

    // copiar x-extensions
    Object.entries(oasData).forEach(([key, value]) => {
      if (key.startsWith('x-')) newOas[key] = value;
    });

    // -------------------------
    // Modularizar components
    // -------------------------
    console.log(chalk.cyan('\n📦 Descomponiendo components:'));

    const components = oasData.components || {};

    for (const [key, content] of Object.entries(components)) {
      if (content && Object.keys(content).length > 0) {
        const fileName = `${key}${FILE_EXTENSION}`;
        const filePath = path.join(COMPONENTS_DIR, fileName);

        const finalContent = FIX_REFS ? fixRefs(content, key) : content;
        writeYamlFile(filePath, finalContent);

        newOas.components[key] = { $ref: `./components/${fileName}` };
      }
    }

    // -------------------------
    // Modularizar paths
    // -------------------------
    console.log(chalk.cyan('\n🗺  Descomponiendo paths:'));

    const originalPaths = oasData.paths || {};

    for (const [route, pathObj] of Object.entries(originalPaths)) {
      if (pathObj && Object.keys(pathObj).length > 0) {
        const fileName = `${slugifyPath(route).replace(/\.yaml$/, '')}${FILE_EXTENSION}`;
        const filePath = path.join(PATHS_DIR, fileName);

        const finalPathObj = FIX_REFS ? fixRefs(pathObj, 'paths') : pathObj;
        writeYamlFile(filePath, finalPathObj);

        newOas.paths[route] = { $ref: `./paths/${fileName}` };
      } else {
        console.log(chalk.yellow(`  • Ruta ignorada porque está vacía: '${route}'`));
      }
    }

    // -------------------------
    // Guardar entrypoint
    // -------------------------
    console.log(chalk.cyan('\n📝 Escribiendo archivo principal modular:'));
    writeYamlFile(MAIN_FILE, newOas);

    await validateWithRedocly(MAIN_FILE);

    console.log(chalk.green('\n✨ Modularización completada exitosamente.'));
    console.log(chalk.green(`   Carpeta generada: ${NORMALIZED_TARGET_DIR}`));
  } catch (error) {
    console.error(chalk.red('\n✖ Error al modularizar:'), error.message);
    process.exit(1);
  }
}

module.exports = {
  modularize,
  TARGET_DIR: NORMALIZED_TARGET_DIR,
  COMPONENTS_DIR,
  PATHS_DIR,
  MAIN_FILE,
};
