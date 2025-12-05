/**
 * =============================================================================
 * BUNDLE.JS — Generador de Bundles para Especificaciones OpenAPI
 * =============================================================================
 *
 * PROPÓSITO:
 * ----------
 * Este módulo consolida especificaciones OpenAPI modularizadas (divididas en
 * múltiples archivos YAML) en un único archivo de salida utilizando Redocly CLI
 * como motor de bundling.
 *
 * CASO DE USO TÍPICO:
 * -------------------
 * Cuando una especificación OpenAPI está organizada en archivos separados
 * (schemas/, paths/, components/, etc.) para facilitar el mantenimiento,
 * este módulo los empaqueta en un solo archivo listo para:
 *   - Publicación en portales de documentación
 *   - Importación en herramientas como Postman, Swagger UI, etc.
 *   - Distribución a consumidores de la API
 *
 * FLUJO DE EJECUCIÓN (3 PASOS):
 * -----------------------------
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 1: BUNDLE PLANO                                               │
 *   │ ─────────────────────                                              │
 *   │ Ejecuta `redocly bundle` para combinar todos los archivos          │
 *   │ referenciados desde el entrypoint en un único archivo YAML.        │
 *   │                                                                    │
 *   │ Opciones aplicables:                                               │
 *   │   • --dereferenced   → Resuelve todos los $ref inline              │
 *   │   • --inject-format  → Añade campos 'format' a los schemas         │
 *   │   • --skip-rule=all  → Omite validación si está deshabilitada      │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 2: LIMPIEZA DE COMPONENTES (OPCIONAL)                         │
 *   │ ───────────────────────────────────────────                        │
 *   │ Si `removeUnusedComponents` está activo, ejecuta una segunda       │
 *   │ pasada de Redocly con --remove-unused-components para eliminar     │
 *   │ schemas, parámetros y otros componentes huérfanos.                 │
 *   │                                                                    │
 *   │ ⚠ NOTA: Se usa archivo temporal para evitar corrupción si falla.  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 3: REESCRITURA SIN ANCHORS YAML (OPCIONAL)                    │
 *   │ ────────────────────────────────────────────────                   │
 *   │ Si NO se usó --dereferenced, reescribe el YAML eliminando los      │
 *   │ anchors (&ref_*) que YAML genera para referencias repetidas.       │
 *   │                                                                    │
 *   │ Esto produce un archivo más limpio y legible.                      │
 *   │                                                                    │
 *   │ ⚠ Se omite si hay dereference activo (evita problemas con ciclos). │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * SISTEMA DE CONFIGURACIÓN:
 * -------------------------
 * La configuración se lee desde config/bundle.yaml
 *
 * Prioridad de valores (mayor a menor):
 *
 *   1. Argumentos del CLI / Input del usuario  (máxima prioridad)
 *   2. config/bundle.yaml                      (configuración del proyecto)
 *
 * ⚠ IMPORTANTE: Los campos requeridos deben estar definidos en bundle.yaml.
 *   Solo paths.bundleOutput es opcional (puede pasarse por CLI).
 *
 * Estructura del archivo de configuración:
 *
 *   paths:
 *     bundleOutput: "./dist/openapi.yaml"
 *
 *   behavior:
 *     cleanDist: true
 *
 *   bundle:
 *     dereference: false
 *     removeUnusedComponents: false
 *     injectFormat: false
 *     validate: true
 *
 * OPCIONES CONFIGURABLES:
 * -----------------------
 *
 *   | Opción                 | Descripción                                    |
 *   |------------------------|------------------------------------------------|
 *   | paths.bundleOutput     | Ruta de salida del bundle generado             |
 *   | behavior.cleanDist     | Elimina el directorio de salida antes de       |
 *   |                        | generar el bundle                              |
 *   | bundle.dereference     | Resuelve todas las referencias ($ref)          |
 *   |                        | dejando el contenido inline                    |
 *   | bundle.removeUnused... | Elimina schemas/parámetros no utilizados       |
 *   | bundle.injectFormat    | Añade campo 'format' a tipos primitivos        |
 *   | bundle.validate        | Valida la especificación durante el bundle     |
 *
 * USO PROGRAMÁTICO:
 * -----------------
 *
 *   const { createBundleGenerator } = require('./bundle');
 *
 *   // Crear instancia con configuración
 *   const bundler = createBundleGenerator();
 *
 *   // Ejecutar bundle
 *   const result = await bundler.generate('./src/openapi/index.yaml', './dist/api.yaml');
 *
 *   console.log(result.outputPath); // Ruta del archivo generado
 *
 * DEPENDENCIAS EXTERNAS:
 * ----------------------
 *   • @redocly/cli — Motor de bundling (debe estar instalado en node_modules)
 *
 * =============================================================================
 */

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const { resolveExecutable } = require('../infrastructure/executables');
const { ensureDir, removeDirIfExists } = require('../infrastructure/fileSystem');
const { runCommand } = require('../infrastructure/runCommand');
const { loadAllConfigs } = require('../infrastructure/configLoader');
const { readYamlFile, writeYamlFile } = require('../infrastructure/yamlUtils');

// =============================================================================
// CONSTANTES
// =============================================================================

/**
 * Nombre del módulo de configuración.
 * Corresponde al archivo config/bundle.yaml
 */
const CONFIG_MODULE_NAME = 'bundle';

/**
 * Campos requeridos en la configuración.
 * Si alguno falta en config/bundle.yaml, se lanza error descriptivo.
 */
const REQUIRED_CONFIG_FIELDS = [
  'behavior.cleanDist',
  'bundle.dereference',
  'bundle.removeUnusedComponents',
  'bundle.injectFormat',
  'bundle.validate',
];

/**
 * Valores por defecto para campos opcionales.
 * Solo se usan como fallback si el campo no existe en config.
 * Los campos en REQUIRED_CONFIG_FIELDS NO tienen default (deben estar en config).
 */
const OPTIONAL_DEFAULTS = {
  // paths.bundleOutput es opcional si se pasa por CLI
};

// =============================================================================
// VALIDADORES
// =============================================================================

/**
 * Valida que un campo sea booleano si está definido.
 *
 * @param {Object} obj - Objeto que contiene el campo a validar
 * @param {string} field - Nombre del campo a validar
 * @param {string} context - Contexto para el mensaje de error (ej: "config.bundle.behavior")
 * @throws {TypeError} Si el campo existe y no es booleano
 *
 * @example
 * assertBooleanField({ enabled: true }, 'enabled', 'config.feature');  // OK
 * assertBooleanField({ enabled: 'yes' }, 'enabled', 'config.feature'); // TypeError
 */
function assertBooleanField(obj, field, context) {
  if (obj[field] !== undefined && typeof obj[field] !== 'boolean') {
    throw new TypeError(
      `El campo "${context}.${field}" debe ser booleano. ` +
      `Valor recibido: ${JSON.stringify(obj[field])} (tipo: ${typeof obj[field]})`
    );
  }
}

/**
 * Valida que un campo sea string si está definido.
 *
 * @param {Object} obj - Objeto que contiene el campo a validar
 * @param {string} field - Nombre del campo a validar
 * @param {string} context - Contexto para el mensaje de error
 * @throws {TypeError} Si el campo existe y no es string
 *
 * @example
 * assertStringField({ path: './dist' }, 'path', 'config.paths');  // OK
 * assertStringField({ path: 123 }, 'path', 'config.paths');       // TypeError
 */
function assertStringField(obj, field, context) {
  if (obj[field] !== undefined && typeof obj[field] !== 'string') {
    throw new TypeError(
      `El campo "${context}.${field}" debe ser string. ` +
      `Valor recibido: ${JSON.stringify(obj[field])} (tipo: ${typeof obj[field]})`
    );
  }
}

/**
 * Valida que un campo requerido exista y no sea undefined.
 *
 * @param {*} value - Valor a validar
 * @param {string} fieldPath - Ruta del campo (ej: "behavior.cleanDist")
 * @param {string} configFile - Nombre del archivo de config para el mensaje
 * @throws {Error} Si el valor es undefined
 */
function assertRequiredField(value, fieldPath, configFile) {
  if (value === undefined) {
    throw new Error(
      `Falta el campo requerido "${fieldPath}" en la configuración.\n` +
      `Defínelo en config/${configFile}.yaml o config/${configFile}.defaults.yaml`
    );
  }
}

/**
 * Obtiene un valor anidado de un objeto usando notación de punto.
 *
 * @param {Object} obj - Objeto del cual extraer el valor
 * @param {string} path - Ruta en notación de punto (ej: "behavior.cleanDist")
 * @returns {*} El valor encontrado o undefined
 *
 * @example
 * getNestedValue({ behavior: { cleanDist: true } }, 'behavior.cleanDist'); // true
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// =============================================================================
// CARGADOR DE CONFIGURACIÓN
// =============================================================================

/**
 * Carga y valida la configuración del bundle desde config/bundle.yaml.
 *
 * Esta función:
 * 1. Lee la configuración desde el archivo YAML
 * 2. Valida los tipos de cada campo
 * 3. Verifica que existan todos los campos requeridos
 * 4. Retorna un objeto de configuración normalizado
 *
 * @returns {BundleConfig} Configuración validada y normalizada
 * @throws {TypeError} Si algún campo tiene un tipo inválido
 * @throws {Error} Si falta un campo requerido en el archivo de config
 *
 * @typedef {Object} BundleConfig
 * @property {string|undefined} outputPath - Ruta de salida del bundle
 * @property {boolean} cleanOutputDirectory - Limpiar directorio antes de generar
 * @property {boolean} dereference - Resolver $ref inline
 * @property {boolean} removeUnusedComponents - Eliminar componentes huérfanos
 * @property {boolean} injectFormat - Inyectar 'format' en schemas
 * @property {boolean} validate - Validar especificación
 *
 * @example
 * const config = loadBundleConfig();
 * console.log(config.dereference); // valor definido en config/bundle.yaml
 */
function loadBundleConfig() {
  const allConfigs = loadAllConfigs();
  const bundleRoot = allConfigs[CONFIG_MODULE_NAME];

  // Si no existe el archivo de configuración
  if (!bundleRoot || Object.keys(bundleRoot).length === 0) {
    throw new Error(
      `No se encontró configuración para el módulo "${CONFIG_MODULE_NAME}".\n` +
      `Crea el archivo config/${CONFIG_MODULE_NAME}.yaml con la estructura requerida.`
    );
  }

  const pathsConfig = bundleRoot.paths || {};
  const behaviorConfig = bundleRoot.behavior || {};
  const bundleConfig = bundleRoot.bundle || {};

  // -------------------------------------------------------------------------
  // Validar tipos
  // -------------------------------------------------------------------------
  assertBooleanField(behaviorConfig, 'cleanDist', 'bundle.behavior');
  assertBooleanField(bundleConfig, 'dereference', 'bundle.bundle');
  assertBooleanField(bundleConfig, 'removeUnusedComponents', 'bundle.bundle');
  assertBooleanField(bundleConfig, 'injectFormat', 'bundle.bundle');
  assertBooleanField(bundleConfig, 'validate', 'bundle.bundle');
  assertStringField(pathsConfig, 'bundleOutput', 'bundle.paths');

  // -------------------------------------------------------------------------
  // Validar campos requeridos
  // -------------------------------------------------------------------------
  for (const fieldPath of REQUIRED_CONFIG_FIELDS) {
    const value = getNestedValue(bundleRoot, fieldPath);
    assertRequiredField(value, fieldPath, CONFIG_MODULE_NAME);
  }

  // -------------------------------------------------------------------------
  // Construir objeto de configuración normalizado
  // -------------------------------------------------------------------------
  return {
    outputPath: pathsConfig.bundleOutput,
    cleanOutputDirectory: behaviorConfig.cleanDist,
    dereference: bundleConfig.dereference,
    removeUnusedComponents: bundleConfig.removeUnusedComponents,
    injectFormat: bundleConfig.injectFormat,
    validate: bundleConfig.validate,
  };
}

// =============================================================================
// UTILIDADES INTERNAS
// =============================================================================

/**
 * Localiza el ejecutable de Redocly CLI.
 *
 * @returns {string} Ruta absoluta al ejecutable
 * @throws {Error} Si Redocly CLI no está instalado
 */
function getRedoclyExecutable() {
  const executablePath = resolveExecutable('redocly');

  if (!executablePath) {
    throw new Error(
      'No se encontró Redocly CLI en node_modules/.bin.\n' +
      'Solución: Ejecuta `npm install @redocly/cli` o verifica las dependencias.'
    );
  }

  return executablePath;
}

/**
 * Construye los argumentos para el comando de Redocly bundle.
 *
 * @param {Object} options - Opciones para construir el comando
 * @param {string} options.inputPath - Ruta del archivo de entrada
 * @param {string} options.outputPath - Ruta del archivo de salida
 * @param {boolean} [options.dereference=false] - Resolver $ref inline
 * @param {boolean} [options.injectFormat=false] - Inyectar 'format'
 * @param {boolean} [options.validate=true] - Validar especificación
 * @param {boolean} [options.removeUnused=false] - Eliminar componentes no usados
 * @returns {string[]} Array de argumentos para el comando
 */
function buildRedoclyArgs({ inputPath, outputPath, dereference, injectFormat, validate, removeUnused }) {
  const args = ['bundle', inputPath, '-o', outputPath];

  if (dereference) args.push('--dereferenced');
  if (injectFormat) args.push('--inject-format');
  if (!validate) args.push('--skip-rule=all');
  if (removeUnused) args.push('--remove-unused-components');

  return args;
}

/**
 * Ejecuta un comando de Redocly CLI.
 *
 * @param {string} executablePath - Ruta al ejecutable de Redocly
 * @param {string[]} args - Argumentos del comando
 * @param {Object} logger - Logger para salida de mensajes
 * @returns {Promise<string>} Salida del comando
 */
async function executeRedoclyCommand(executablePath, args, logger) {
  const command = [`"${executablePath}"`, ...args.map(arg => 
    arg.startsWith('-') ? arg : `"${arg}"`
  )].join(' ');

  const { stdout } = await runCommand(command);

  if (stdout && stdout.trim()) {
    logger.log(stdout);
  }

  return stdout;
}

/**
 * Mueve un archivo de forma segura (atómica cuando es posible).
 *
 * @param {string} sourcePath - Ruta del archivo origen
 * @param {string} destinationPath - Ruta del archivo destino
 */
function moveFileSafely(sourcePath, destinationPath) {
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch (error) {
    fs.copyFileSync(sourcePath, destinationPath);
    fs.unlinkSync(sourcePath);
  }
}

// =============================================================================
// PASOS DEL BUNDLE
// =============================================================================

/**
 * PASO 1: Genera el bundle plano combinando todos los archivos.
 *
 * Este paso ejecuta `redocly bundle` sin --remove-unused-components
 * para crear el archivo unificado inicial.
 *
 * @param {Object} context - Contexto de ejecución
 * @param {string} context.redoclyPath - Ruta al ejecutable de Redocly
 * @param {string} context.inputPath - Ruta del entrypoint
 * @param {string} context.outputPath - Ruta de salida
 * @param {BundleConfig} context.config - Configuración del bundle
 * @param {Object} context.logger - Logger para mensajes
 * @returns {Promise<void>}
 */
async function executeBaseBundleStep({ redoclyPath, inputPath, outputPath, config, logger }) {
  logger.log(chalk.gray('→ Paso 1/3: Generando bundle base...'));

  const args = buildRedoclyArgs({
    inputPath,
    outputPath,
    dereference: config.dereference,
    injectFormat: config.injectFormat,
    validate: config.validate,
    removeUnused: false,
  });

  await executeRedoclyCommand(redoclyPath, args, logger);
  logger.log(chalk.gray('  ✓ Bundle base generado'));
}

/**
 * PASO 2: Elimina componentes no utilizados (opcional).
 *
 * Este paso ejecuta una segunda pasada de Redocly con
 * --remove-unused-components sobre el bundle ya generado.
 *
 * ⚠ Usa archivo temporal para evitar corrupción si falla.
 *
 * @param {Object} context - Contexto de ejecución
 * @param {string} context.redoclyPath - Ruta al ejecutable de Redocly
 * @param {string} context.outputPath - Ruta del bundle a procesar
 * @param {BundleConfig} context.config - Configuración del bundle
 * @param {Object} context.logger - Logger para mensajes
 * @returns {Promise<void>}
 */
async function executeCleanupStep({ redoclyPath, outputPath, config, logger }) {
  if (!config.removeUnusedComponents) {
    logger.log(chalk.gray('→ Paso 2/3: Limpieza de componentes [OMITIDO]'));
    return;
  }

  logger.log(chalk.gray('→ Paso 2/3: Eliminando componentes no utilizados...'));

  const tempOutputPath = `${outputPath}.tmp`;

  const args = buildRedoclyArgs({
    inputPath: outputPath,
    outputPath: tempOutputPath,
    dereference: false,
    injectFormat: false,
    validate: config.validate,
    removeUnused: true,
  });

  try {
    await executeRedoclyCommand(redoclyPath, args, logger);
    moveFileSafely(tempOutputPath, outputPath);
    logger.log(chalk.gray('  ✓ Componentes huérfanos eliminados'));
  } catch (error) {
    if (fs.existsSync(tempOutputPath)) {
      fs.unlinkSync(tempOutputPath);
    }
    throw error;
  }
}

/**
 * PASO 3: Reescribe el YAML sin anchors (opcional).
 *
 * Cuando YAML serializa objetos con referencias repetidas, genera
 * anchors (&ref_*) automáticamente. Este paso los elimina para
 * producir un archivo más limpio.
 *
 * ⚠ Se omite si dereference está activo (evita problemas con ciclos).
 *
 * @param {Object} context - Contexto de ejecución
 * @param {string} context.outputPath - Ruta del bundle a procesar
 * @param {BundleConfig} context.config - Configuración del bundle
 * @param {Object} context.logger - Logger para mensajes
 * @returns {Promise<void>}
 */
async function executeYamlRewriteStep({ outputPath, config, logger }) {
  if (config.dereference) {
    logger.log(chalk.gray('→ Paso 3/3: Reescritura YAML [OMITIDO - dereference activo]'));
    return;
  }

  logger.log(chalk.gray('→ Paso 3/3: Reescribiendo YAML sin anchors...'));

  try {
    const bundleContent = readYamlFile(outputPath);
    writeYamlFile(outputPath, bundleContent);
    logger.log(chalk.gray('  ✓ YAML reescrito sin anchors'));
  } catch (error) {
    logger.warn(
      chalk.yellow(`  ⚠ No se pudo reescribir sin anchors: ${error.message}`)
    );
  }
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/**
 * Crea una instancia del generador de bundles.
 *
 * Esta función factory permite inyectar dependencias (como el logger)
 * facilitando el testing y la personalización.
 *
 * @param {Object} [options={}] - Opciones de configuración
 * @param {Object} [options.logger=console] - Logger para mensajes
 * @returns {BundleGenerator} Instancia del generador
 *
 * @typedef {Object} BundleGenerator
 * @property {Function} generate - Genera el bundle
 * @property {Function} getConfig - Obtiene la configuración actual
 *
 * @example
 * const bundler = createBundleGenerator();
 * await bundler.generate('./src/openapi/index.yaml');
 *
 * @example
 * // Con logger personalizado
 * const bundler = createBundleGenerator({
 *   logger: myCustomLogger
 * });
 */
function createBundleGenerator({ logger = console } = {}) {
  /**
   * Genera un bundle OpenAPI a partir de un entrypoint.
   *
   * @param {string} inputPath - Ruta al archivo entrypoint (obligatorio)
   * @param {string} [outputPath] - Ruta de salida (opcional si está en config)
   * @returns {Promise<BundleResult>} Resultado de la operación
   *
   * @typedef {Object} BundleResult
   * @property {string} outputPath - Ruta del archivo generado
   * @property {boolean} success - Indica si la operación fue exitosa
   *
   * @throws {Error} Si inputPath no es válido
   * @throws {Error} Si no se puede determinar la ruta de salida
   * @throws {Error} Si Redocly CLI no está instalado
   */
  async function generate(inputPath, outputPath) {
    // -------------------------------------------------------------------------
    // Validación de entrada
    // -------------------------------------------------------------------------
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error(
        'El parámetro inputPath es obligatorio y debe ser una ruta válida al entrypoint OpenAPI.'
      );
    }

    // -------------------------------------------------------------------------
    // Cargar configuración
    // -------------------------------------------------------------------------
    const config = loadBundleConfig();

    const resolvedOutputPath = outputPath || config.outputPath;

    if (!resolvedOutputPath || typeof resolvedOutputPath !== 'string') {
      throw new Error(
        'No se pudo determinar la ruta de salida del bundle.\n' +
        'Opciones:\n' +
        '  • Pasar como segundo argumento: generate(input, output)\n' +
        '  • Configurar en config/bundle.yaml → paths.bundleOutput'
      );
    }

    // -------------------------------------------------------------------------
    // Preparar entorno
    // -------------------------------------------------------------------------
    logger.log(chalk.cyan('\n📦 Iniciando generación de bundle OpenAPI\n'));
    logger.log(chalk.gray(`   Entrada:  ${inputPath}`));
    logger.log(chalk.gray(`   Salida:   ${resolvedOutputPath}\n`));

    const redoclyPath = getRedoclyExecutable();
    const outputDir = path.dirname(resolvedOutputPath);

    if (config.cleanOutputDirectory) {
      removeDirIfExists(outputDir);
    }
    ensureDir(outputDir);

    // -------------------------------------------------------------------------
    // Ejecutar pasos del bundle
    // -------------------------------------------------------------------------
    const context = {
      redoclyPath,
      inputPath,
      outputPath: resolvedOutputPath,
      config,
      logger,
    };

    await executeBaseBundleStep(context);
    await executeCleanupStep(context);
    await executeYamlRewriteStep(context);

    // -------------------------------------------------------------------------
    // Resultado
    // -------------------------------------------------------------------------
    logger.log(chalk.bold.green(`\n✅ Bundle generado exitosamente: ${resolvedOutputPath}\n`));

    return {
      outputPath: resolvedOutputPath,
      success: true,
    };
  }

  /**
   * Obtiene la configuración actual del bundle.
   *
   * @returns {BundleConfig} Configuración actual
   */
  function getConfig() {
    return loadBundleConfig();
  }

  return {
    generate,
    getConfig,
  };
}

/**
 * Genera un bundle OpenAPI (función de conveniencia).
 *
 * @param {string} inputPath - Ruta al archivo entrypoint
 * @param {string} [outputPath] - Ruta de salida (opcional si está en config)
 * @returns {Promise<BundleResult>} Resultado de la operación
 *
 * @example
 * const { generateBundle } = require('./bundle');
 * await generateBundle('./src/openapi/index.yaml', './dist/api.yaml');
 */
async function generateBundle(inputPath, outputPath) {
  const bundler = createBundleGenerator();
  return bundler.generate(inputPath, outputPath);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // API principal
  createBundleGenerator,
  generateBundle,

  // Para testing
  __internal: {
    loadBundleConfig,
    assertBooleanField,
    assertStringField,
    assertRequiredField,
    buildRedoclyArgs,
    getNestedValue,
    CONFIG_MODULE_NAME,
    REQUIRED_CONFIG_FIELDS,
  },
};