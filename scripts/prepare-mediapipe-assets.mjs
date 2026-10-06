import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const targetDirectory = path.join(root, "public", "mediapipe", "wasm");
const modelPath = path.join(root, "public", "mediapipe", "models", "selfie_segmenter.tflite");
const modelSha256 = "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b";
const licensePath = path.join(root, "public", "mediapipe", "LICENSE-APACHE-2.0.txt");
const wasmFiles = [
	"vision_wasm_internal.js",
	"vision_wasm_internal.wasm",
	"vision_wasm_module_internal.js",
	"vision_wasm_module_internal.wasm",
	"vision_wasm_nosimd_internal.js",
	"vision_wasm_nosimd_internal.wasm",
];

if (!fs.existsSync(sourceDirectory)) {
	throw new Error(
		"MediaPipe WASM sources are missing. Run npm install before starting Recordly.",
	);
}

if (!fs.existsSync(modelPath)) {
	throw new Error("The bundled MediaPipe selfie segmentation model is missing.");
}

if (!fs.existsSync(licensePath)) {
	throw new Error("The bundled MediaPipe Apache 2.0 license is missing.");
}

const modelDigest = createHash("sha256").update(fs.readFileSync(modelPath)).digest("hex");
if (modelDigest !== modelSha256) {
	throw new Error(`Unexpected selfie segmentation model checksum: ${modelDigest}`);
}

fs.mkdirSync(targetDirectory, { recursive: true });
for (const fileName of wasmFiles) {
	const sourcePath = path.join(sourceDirectory, fileName);
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`MediaPipe WASM asset is missing: ${fileName}`);
	}
	fs.copyFileSync(sourcePath, path.join(targetDirectory, fileName));
}

console.log(`Prepared ${wasmFiles.length} MediaPipe WASM assets.`);
