/**
 * LSTM Neural Network for Character-Level Sequence Prediction
 * 
 * Implements a true LSTM (Long Short-Term Memory) network from scratch
 * for generative character-level sequence prediction in payload mutation.
 */

import type { FeatureVector } from '../types.js';

// ============== Types ==============

export interface LSTMCellState {
  hidden: number[];
  cell: number[];
}

/**
 * Cached intermediate values from forward pass for efficient backpropagation
 */
export interface LSTMCache {
  // Input gate activations (pre-sigmoid)
  inputGateRaw: number[];
  // Input gate activations (post-sigmoid)
  inputGate: number[];
  
  // Forget gate activations (pre-sigmoid)
  forgetGateRaw: number[];
  // Forget gate activations (post-sigmoid)
  forgetGate: number[];
  
  // Cell candidate activations (pre-tanh)
  cellCandidateRaw: number[];
  // Cell candidate activations (post-tanh)
  cellCandidate: number[];
  
  // Output gate activations (pre-sigmoid)
  outputGateRaw: number[];
  // Output gate activations (post-sigmoid)
  outputGate: number[];
  
  // Cell state (post-update, pre-output gate)
  cell: number[];
  // Hidden state (post-output gate)
  hidden: number[];
  
  // Input for next timestep
  input: number[];
  prevHidden: number[];
  prevCell: number[];
}

export interface LSTMWeights {
  // Input gate weights
  // i_t = sigmoid(W_ix * x_t + W_ih * h_{t-1} + W_ic * c_{t-1} + b_i)
  Wix: number[][];
  Wih: number[][];
  Wic: number[][];
  bi: number[];
  
  // Forget gate weights
  // f_t = sigmoid(W_fx * x_t + W_fh * h_{t-1} + W_fc * c_{t-1} + b_f)
  Wfx: number[][];
  Wfh: number[][];
  Wfc: number[][];
  bf: number[];
  
  // Cell candidate weights
  // c~_t = tanh(W_cx * x_t + W_ch * h_{t-1} + b_c)
  Wcx: number[][];
  Wch: number[][];
  bc: number[];
  
  // Output gate weights
  // o_t = sigmoid(W_ox * x_t + W_oh * h_{t-1} + W_oc * c_t + b_o)
  Wox: number[][];
  Woh: number[][];
  Woc: number[][];
  bo: number[];
  
  // Hidden to output weights
  // y_t = W_y * h_t + b_y
  Why: number[][];
  by: number[];
}

export interface LSTMConfig {
  inputSize: number;
  hiddenSize: number;
  outputSize: number;
  seed?: number;
}

// ============== Serialization Utilities ==============

/**
 * Serialize LSTMWeights to a flat Map for storage (e.g., MongoDB)
 * Converts nested 2D arrays to flattened 1D arrays
 */
export function serializeWeights(weights: LSTMWeights): Map<string, number[]> {
  const serialized = new Map<string, number[]>();

  for (const [key, value] of Object.entries(weights)) {
    if (Array.isArray(value)) {
      // Flatten 2D matrix to 1D array
      serialized.set(key, value.flat());
    } else if (typeof value === 'number') {
      // Single number becomes single-element array
      serialized.set(key, [value]);
    }
  }

  return serialized;
}

/**
 * Deserialize from flat Map back to LSTMWeights
 * Converts flattened 1D arrays back to 2D arrays with dimensions
 */
export function deserializeWeights(
  serialized: Map<string, number[]>,
  config: LSTMConfig
): LSTMWeights {
  const { hiddenSize, inputSize, outputSize } = config;

  const weights: LSTMWeights = {
    // Input gate weights
    Wix: deserializeMatrix(serialized.get('Wix'), hiddenSize, inputSize),
    Wih: deserializeMatrix(serialized.get('Wih'), hiddenSize, hiddenSize),
    Wic: deserializeMatrix(serialized.get('Wic'), hiddenSize, hiddenSize),
    bi: deserializeVector(serialized.get('bi'), hiddenSize),

    // Forget gate weights
    Wfx: deserializeMatrix(serialized.get('Wfx'), hiddenSize, inputSize),
    Wfh: deserializeMatrix(serialized.get('Wfh'), hiddenSize, hiddenSize),
    Wfc: deserializeMatrix(serialized.get('Wfc'), hiddenSize, hiddenSize),
    bf: deserializeVector(serialized.get('bf'), hiddenSize),

    // Cell candidate weights
    Wcx: deserializeMatrix(serialized.get('Wcx'), hiddenSize, inputSize),
    Wch: deserializeMatrix(serialized.get('Wch'), hiddenSize, hiddenSize),
    bc: deserializeVector(serialized.get('bc'), hiddenSize),

    // Output gate weights
    Wox: deserializeMatrix(serialized.get('Wox'), hiddenSize, inputSize),
    Woh: deserializeMatrix(serialized.get('Woh'), hiddenSize, hiddenSize),
    Woc: deserializeMatrix(serialized.get('Woc'), hiddenSize, hiddenSize),
    bo: deserializeVector(serialized.get('bo'), hiddenSize),

    // Output layer weights
    Why: deserializeMatrix(serialized.get('Why'), outputSize, hiddenSize),
    by: deserializeVector(serialized.get('by'), outputSize),
  };

  return weights;
}

/**
 * Helper: deserialize a flattened array to 2D matrix
 */
function deserializeMatrix(
  flat: number[] | undefined,
  rows: number,
  cols: number
): number[][] {
  if (!flat || flat.length !== rows * cols) {
    // Return zero matrix with correct dimensions if data missing
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  }

  const matrix: number[][] = [];
  for (let i = 0; i < rows; i++) {
    matrix.push(flat.slice(i * cols, (i + 1) * cols));
  }
  return matrix;
}

/**
 * Helper: deserialize to 1D vector
 */
function deserializeVector(
  flat: number[] | undefined,
  size: number
): number[] {
  if (!flat || flat.length !== size) {
    return Array.from({ length: size }, () => 0);
  }
  return [...flat];
}

// ============== Matrix Utilities ==============

/**
 * Xavier/Glorot initialization for weights
 * Scales weights based on input and output dimensions for proper gradient flow
 */
function xavierInit(rows: number, cols: number, seed?: number): number[][] {
  const random = seed ? mulberry32(seed) : Math.random;
  const scale = Math.sqrt(2.0 / (rows + cols));
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => random() * 2 - 1 * scale)
  );
}

/**
 * Create matrix with Xavier initialization (fan-in based)
 */
function createMatrix(rows: number, cols: number, seed?: number): number[][] {
  const random = seed ? mulberry32(seed) : Math.random;
  const scale = Math.sqrt(1.0 / cols);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => random() * 2 - 1 * scale)
  );
}

/**
 * Create bias vector initialized to zeros
 */
function createVector(size: number, seed?: number): number[] {
  return Array.from({ length: size }, () => 0);
}

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function matrixMultiply(a: number[][], b: number[][], transB = false): number[][] {
  const aRows = a.length;
  const aCols = a[0].length;
  const bRows = transB ? b[0].length : b.length;
  const bCols = transB ? b.length : b[0].length;

  const result: number[][] = Array.from({ length: aRows }, () =>
    Array.from({ length: bCols }, () => 0)
  );

  for (let i = 0; i < aRows; i++) {
    for (let j = 0; j < bCols; j++) {
      for (let k = 0; k < aCols; k++) {
        result[i][j] += a[i][k] * (transB ? b[k][j] : b[k][j]);
      }
    }
  }

  return result;
}

function vectorMatrixMultiply(v: number[], m: number[][]): number[] {
  const rows = m.length;
  const cols = m[0].length;
  const result = Array.from({ length: cols }, () => 0);

  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < rows; i++) {
      result[j] += v[i] * m[i][j];
    }
  }

  return result;
}

function matrixAdd(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}

function matrixSubtract(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val - b[i][j]));
}

function scalarMultiply(m: number[][], scalar: number): number[][] {
  return m.map((row) => row.map((val) => val * scalar));
}

function tanh(x: number): number {
  return Math.tanh(x);
}

function tanhDerivative(y: number): number {
  return 1 - y * y;
}

function sigmoid(x: number): number {
  return x < -500 ? 0 : x > 500 ? 1 : 1 / (1 + Math.exp(-x));
}

function sigmoidDerivative(y: number): number {
  return y * (1 - y);
}

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

// ============== Gradient Utilities ==============

function zeroMatrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

function zeroVector(size: number): number[] {
  return Array.from({ length: size }, () => 0);
}

function cloneMatrix(m: number[][]): number[][] {
  return m.map((row) => [...row]);
}

function addToMatrix(target: number[][], source: number[][]): void {
  for (let i = 0; i < target.length; i++) {
    for (let j = 0; j < target[i].length; j++) {
      target[i][j] += source[i][j];
    }
  }
}

// ============== LSTM Cell ==============

export class LSTMCell {
  public readonly config: LSTMConfig;
  public weights: LSTMWeights;
  private tempHidden: number[] = [];
  private tempCell: number[] = [];

  constructor(config: LSTMConfig) {
    this.config = config;
    const { inputSize, hiddenSize, outputSize } = config;
    const seed = config.seed ?? Date.now();

// Input gate weights
    this.weights = {
      // Input gate: W_ix * x_t + W_ih * h_{t-1} + W_ic * c_{t-1} + b_i
      Wix: createMatrix(hiddenSize, inputSize, seed),
      Wih: createMatrix(hiddenSize, hiddenSize, seed + 1),
      Wic: createMatrix(hiddenSize, hiddenSize, seed + 2),
      bi: createVector(hiddenSize, seed + 3),
      
      // Forget gate: W_fx * x_t + W_fh * h_{t-1} + W_fc * c_{t-1} + b_f
      Wfx: createMatrix(hiddenSize, inputSize, seed + 4),
      Wfh: createMatrix(hiddenSize, hiddenSize, seed + 5),
      Wfc: createMatrix(hiddenSize, hiddenSize, seed + 6),
      bf: createVector(hiddenSize, seed + 7),
      
      // Cell candidate: W_cx * x_t + W_ch * h_{t-1} + b_c
      Wcx: createMatrix(hiddenSize, inputSize, seed + 8),
      Wch: createMatrix(hiddenSize, hiddenSize, seed + 9),
      bc: createVector(hiddenSize, seed + 10),
      
      // Output gate: W_ox * x_t + W_oh * h_{t-1} + W_oc * c_t + b_o
      Wox: createMatrix(hiddenSize, inputSize, seed + 11),
      Woh: createMatrix(hiddenSize, hiddenSize, seed + 12),
      Woc: createMatrix(hiddenSize, hiddenSize, seed + 13),
      bo: createVector(hiddenSize, seed + 14),
      
      // Output: W_y * h_t + b_y
      Why: createMatrix(outputSize, hiddenSize, seed + 15),
      by: createVector(outputSize, seed + 16),
    };

    this.tempHidden = createVector(hiddenSize);
    this.tempCell = createVector(hiddenSize);
  }

public forward(
    input: number[],
    prevHidden: number[],
    prevCell: number[]
  ): { output: number[]; hidden: number[]; cell: number[] } {
    const { hiddenSize } = this.config;

    // Input gate: i_t = sigmoid(W_ix * x_t + W_ih * h_{t-1} + W_ic * c_{t-1} + b_i)
    const inputGateInput = this.computeInputGate(input, prevHidden, prevCell);
    const inputGate = inputGateInput.map(sigmoid);

    // Forget gate: f_t = sigmoid(W_fx * x_t + W_fh * h_{t-1} + W_fc * c_{t-1} + b_f)
    const forgetGateInput = this.computeForgetGate(input, prevHidden, prevCell);
    const forgetGate = forgetGateInput.map(sigmoid);

    // Cell candidate: c~_t = tanh(W_cx * x_t + W_ch * h_{t-1} + b_c)
    const cellCandidateInput = this.computeCellCandidate(input, prevHidden);
    const cellCandidate = cellCandidateInput.map(tanh);

    // Cell: c_t = f_t * c_{t-1} + i_t * c~_t
    const cell = prevCell.map((c, idx) => forgetGate[idx] * c + inputGate[idx] * cellCandidate[idx]);

    // Output gate: o_t = sigmoid(W_ox * x_t + W_oh * h_{t-1} + W_oc * c_t + b_o)
    const outputGateInput = this.computeOutputGate(input, prevHidden, cell);
    const outputGate = outputGateInput.map(sigmoid);

    // Hidden: h_t = o_t * tanh(c_t)
    const hidden = cell.map((c, idx) => outputGate[idx] * tanh(c));

    // Output: y_t = W_y * h_t + b_y
    const output = this.computeOutput(hidden);

    this.tempHidden = [...hidden];
    this.tempCell = [...cell];

    return { output, hidden, cell };
  }

  /**
   * Forward pass with caching for backpropagation
   * Stores intermediate values for efficient gradient computation
   */
  public forwardWithCache(
    input: number[],
    prevHidden: number[],
    prevCell: number[]
  ): { output: number[]; hidden: number[]; cell: number[]; cache: LSTMCache } {
    const { hiddenSize } = this.config;

    // Input gate
    const inputGateRaw = this.computeInputGate(input, prevHidden, prevCell);
    const inputGate = inputGateRaw.map(sigmoid);

    // Forget gate
    const forgetGateRaw = this.computeForgetGate(input, prevHidden, prevCell);
    const forgetGate = forgetGateRaw.map(sigmoid);

    // Cell candidate
    const cellCandidateRaw = this.computeCellCandidate(input, prevHidden);
    const cellCandidate = cellCandidateRaw.map(tanh);

    // Cell state
    const cell = prevCell.map((c, idx) => forgetGate[idx] * c + inputGate[idx] * cellCandidate[idx]);

    // Output gate
    const outputGateRaw = this.computeOutputGate(input, prevHidden, cell);
    const outputGate = outputGateRaw.map(sigmoid);

    // Hidden state
    const hidden = cell.map((c, idx) => outputGate[idx] * tanh(c));

    // Output
    const output = this.computeOutput(hidden);

    // Cache intermediate values
    const cache: LSTMCache = {
      inputGateRaw: [...inputGateRaw],
      inputGate: [...inputGate],
      forgetGateRaw: [...forgetGateRaw],
      forgetGate: [...forgetGate],
      cellCandidateRaw: [...cellCandidateRaw],
      cellCandidate: [...cellCandidate],
      outputGateRaw: [...outputGateRaw],
      outputGate: [...outputGate],
      cell: [...cell],
      hidden: [...hidden],
      input: [...input],
      prevHidden: [...prevHidden],
      prevCell: [...prevCell],
    };

return { output, hidden, cell, cache };
  }

  /**
   * Backpropagation Through Time (BPTT) for a single timestep
   * Returns gradients with respect to weights
   */
  public backprop(
    cache: LSTMCache,
    gradOutput: number[],  // Gradient with respect to output (dL/dy_t)
    gradHidden: number[], // Gradient from next timestep (dL/dh_t+1)
    gradCell: number[]    // Gradient from next timestep (dL/dc_t+1)
  ): {
    dInput: number[];
    dPrevHidden: number[];
    dPrevCell: number[];
  } {
    const { hiddenSize, inputSize, outputSize } = this.config;
    const { cell, hidden, outputGate, cellCandidate, forgetGate, inputGate, input, prevHidden, prevCell } = cache;

    // Gradients for output layer: y = Why * h + by
    // dL/dh = Why^T * dL/dy
    const dHidden: number[] = zeroVector(hiddenSize);
    for (let i = 0; i < hiddenSize; i++) {
      for (let j = 0; j < outputSize; j++) {
        dHidden[i] += this.weights.Why[j][i] * gradOutput[j];
      }
    }
    // Add gradient from next timestep
    for (let i = 0; i < hiddenSize; i++) {
      dHidden[i] += gradHidden[i];
    }

    // dL/dby = gradOutput
    const dBy = [...gradOutput];

    // dL/dWhy = gradOutput * h^T
    const dWhy: number[][] = zeroMatrix(outputSize, hiddenSize);
    for (let i = 0; i < outputSize; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        dWhy[i][j] = gradOutput[i] * hidden[j];
      }
    }

    // Gradients through output gate: h_t = o_t * tanh(c_t)
    // dL/do = dL/dh * tanh(c_t)
    const dOutputGateRaw: number[] = [];
    for (let i = 0; i < hiddenSize; i++) {
      dOutputGateRaw[i] = dHidden[i] * tanh(cell[i]) * sigmoidDerivative(outputGate[i]);
    }

    // dL/dc from hidden: dL/dh * o_t * tanh'(c_t)
    let dCellRaw: number[] = [];
    for (let i = 0; i < hiddenSize; i++) {
      dCellRaw[i] = dHidden[i] * outputGate[i] * tanhDerivative(tanh(cell[i]));
    }
    // Add gradient from next timestep
    for (let i = 0; i < hiddenSize; i++) {
      dCellRaw[i] += gradCell[i];
    }

    // Cell state gradient: c_t = f_t * c_{t-1} + i_t * c~_t
    // dL/dc~ = dL/dc * i_t * tanh'(c~_t)
    const dCellCandidateRaw: number[] = [];
    for (let i = 0; i < hiddenSize; i++) {
      dCellCandidateRaw[i] = dCellRaw[i] * inputGate[i] * tanhDerivative(cellCandidate[i]);
    }

    // dL/di = dL/dc * c~_t * sigmoid'(i_t)
    const dInputGateRaw: number[] = [];
    for (let i = 0; i < hiddenSize; i++) {
      dInputGateRaw[i] = dCellRaw[i] * cellCandidate[i] * sigmoidDerivative(inputGate[i]);
    }

    // dL/df = dL/dc * c_{t-1} * sigmoid'(f_t)
    const dForgetGateRaw: number[] = [];
    for (let i = 0; i < hiddenSize; i++) {
      dForgetGateRaw[i] = dCellRaw[i] * prevCell[i] * sigmoidDerivative(forgetGate[i]);
    }

    // dL/dc_{t-1} = dL/dc * f_t
    const dPrevCellGrad: number[] = [];
    for (let i = 0; i < hiddenSize; i++) {
      dPrevCellGrad[i] = dCellRaw[i] * forgetGate[i];
    }

    // Now compute weight gradients for each gate
    // Input gate gradients
    const dWix: number[][] = zeroMatrix(hiddenSize, inputSize);
    const dWih: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dWic: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dBi: number[] = [...dInputGateRaw];

    for (let i = 0; i < hiddenSize; i++) {
      const scale = dInputGateRaw[i];
      for (let j = 0; j < inputSize; j++) {
        dWix[i][j] = scale * input[j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        dWih[i][j] = scale * prevHidden[j];
        dWic[i][j] = scale * prevCell[j];
      }
    }

    // Forget gate gradients
    const dWfx: number[][] = zeroMatrix(hiddenSize, inputSize);
    const dWfh: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dWfc: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dBf: number[] = [...dForgetGateRaw];

    for (let i = 0; i < hiddenSize; i++) {
      const scale = dForgetGateRaw[i];
      for (let j = 0; j < inputSize; j++) {
        dWfx[i][j] = scale * input[j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        dWfh[i][j] = scale * prevHidden[j];
        dWfc[i][j] = scale * prevCell[j];
      }
    }

    // Cell candidate gradients
    const dWcx: number[][] = zeroMatrix(hiddenSize, inputSize);
    const dWch: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dBc: number[] = [...dCellCandidateRaw];

    for (let i = 0; i < hiddenSize; i++) {
      const scale = dCellCandidateRaw[i];
      for (let j = 0; j < inputSize; j++) {
        dWcx[i][j] = scale * input[j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        dWch[i][j] = scale * prevHidden[j];
      }
    }

    // Output gate gradients
    const dWox: number[][] = zeroMatrix(hiddenSize, inputSize);
    const dWoh: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dWoc: number[][] = zeroMatrix(hiddenSize, hiddenSize);
    const dBo: number[] = [...dOutputGateRaw];

    for (let i = 0; i < hiddenSize; i++) {
      const scale = dOutputGateRaw[i];
      for (let j = 0; j < inputSize; j++) {
        dWox[i][j] = scale * input[j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        dWoh[i][j] = scale * prevHidden[j];
        dWoc[i][j] = scale * cell[j];
      }
    }

    // Compute dInput for previous hidden state (through all gates)
    const dPrevHidden: number[] = zeroVector(hiddenSize);
    // From input gate
    for (let i = 0; i < hiddenSize; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        dPrevHidden[j] += dInputGateRaw[i] * this.weights.Wih[i][j];
      }
    }
    // From forget gate
    for (let i = 0; i < hiddenSize; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        dPrevHidden[j] += dForgetGateRaw[i] * this.weights.Wfh[i][j];
      }
    }
    // From cell candidate
    for (let i = 0; i < hiddenSize; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        dPrevHidden[j] += dCellCandidateRaw[i] * this.weights.Wch[i][j];
      }
    }
    // From output gate
    for (let i = 0; i < hiddenSize; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        dPrevHidden[j] += dOutputGateRaw[i] * this.weights.Woh[i][j];
      }
    }

    // Weight gradients to apply (stored in temporary storage for optimizer)
    this._tempWeightGrads = {
      dWix, dWih, dWic, dBi,
      dWfx, dWfh, dWfc, dBf,
      dWcx, dWch, dBc,
      dWox, dWoh, dWoc, dBo,
      dWhy, dBy,
    };

    return {
      dInput: zeroVector(inputSize), // Not used in our model
      dPrevHidden,
      dPrevCell: dPrevCellGrad,
    };
  }

  private _tempWeightGrads: any = null;

  public getWeightGrads(): any {
    return this._tempWeightGrads;
  }

  /**
   * Apply gradients to weights using given learning rate
   */
  public applyGradients(learningRate: number, grads: any): void {
    const { hiddenSize, inputSize, outputSize } = this.config;

    // Input gate
    for (let i = 0; i < hiddenSize; i++) {
      this.weights.bi[i] -= learningRate * grads.dBi[i];
      for (let j = 0; j < inputSize; j++) {
        this.weights.Wix[i][j] -= learningRate * grads.dWix[i][j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        this.weights.Wih[i][j] -= learningRate * grads.dWih[i][j];
        this.weights.Wic[i][j] -= learningRate * grads.dWic[i][j];
      }
    }

    // Forget gate
    for (let i = 0; i < hiddenSize; i++) {
      this.weights.bf[i] -= learningRate * grads.dBf[i];
      for (let j = 0; j < inputSize; j++) {
        this.weights.Wfx[i][j] -= learningRate * grads.dWfx[i][j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        this.weights.Wfh[i][j] -= learningRate * grads.dWfh[i][j];
        this.weights.Wfc[i][j] -= learningRate * grads.dWfc[i][j];
      }
    }

    // Cell candidate
    for (let i = 0; i < hiddenSize; i++) {
      this.weights.bc[i] -= learningRate * grads.dBc[i];
      for (let j = 0; j < inputSize; j++) {
        this.weights.Wcx[i][j] -= learningRate * grads.dWcx[i][j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        this.weights.Wch[i][j] -= learningRate * grads.dWch[i][j];
      }
    }

    // Output gate
    for (let i = 0; i < hiddenSize; i++) {
      this.weights.bo[i] -= learningRate * grads.dBo[i];
      for (let j = 0; j < inputSize; j++) {
        this.weights.Wox[i][j] -= learningRate * grads.dWox[i][j];
      }
      for (let j = 0; j < hiddenSize; j++) {
        this.weights.Woh[i][j] -= learningRate * grads.dWoh[i][j];
        this.weights.Woc[i][j] -= learningRate * grads.dWoc[i][j];
      }
    }

    // Output layer
    for (let i = 0; i < outputSize; i++) {
      this.weights.by[i] -= learningRate * grads.dBy[i];
      for (let j = 0; j < hiddenSize; j++) {
        this.weights.Why[i][j] -= learningRate * grads.dWhy[i][j];
      }
    }
  }

  private computeInputGate(input: number[], prevHidden: number[], prevCell: number[]): number[] {
    const { hiddenSize } = this.config;
    const Wix = this.weights.Wix;
    const Wih = this.weights.Wih;
    const Wic = this.weights.Wic;
    const bi = this.weights.bi;

    const result = createVector(hiddenSize);
    
    // W_ix * x_t
    const ix = vectorMatrixMultiply(input, Wix);
    // W_ih * h_{t-1}
    const ih = vectorMatrixMultiply(prevHidden, Wih);
    // W_ic * c_{t-1}
    const ic = vectorMatrixMultiply(prevCell, Wic);

    for (let i = 0; i < hiddenSize; i++) {
      result[i] = ix[i] + ih[i] + ic[i] + bi[i];
    }

    return result;
  }

private computeForgetGate(input: number[], prevHidden: number[], prevCell: number[]): number[] {
    const { hiddenSize } = this.config;
    const Wfx = this.weights.Wfx;
    const Wfh = this.weights.Wfh;
    const Wfc = this.weights.Wfc;
    const bf = this.weights.bf;

    const result = createVector(hiddenSize);
    
    // W_fx * x_t
    const fx = vectorMatrixMultiply(input, Wfx);
    // W_fh * h_{t-1}
    const fh = vectorMatrixMultiply(prevHidden, Wfh);
    // W_fc * c_{t-1}
    const fc = vectorMatrixMultiply(prevCell, Wfc);

    for (let i = 0; i < hiddenSize; i++) {
      result[i] = fx[i] + fh[i] + fc[i] + bf[i];
    }

    return result;
  }

private computeCellCandidate(input: number[], prevHidden: number[]): number[] {
    const { hiddenSize } = this.config;
    const Wcx = this.weights.Wcx;
    const Wch = this.weights.Wch;
    const bc = this.weights.bc;

    const result = createVector(hiddenSize);
    
    // W_cx * x_t
    const cx = vectorMatrixMultiply(input, Wcx);
    // W_ch * h_{t-1}
    const ch = vectorMatrixMultiply(prevHidden, Wch);

    for (let i = 0; i < hiddenSize; i++) {
      result[i] = cx[i] + ch[i] + bc[i];
    }

    return result;
  }

private computeOutputGate(input: number[], prevHidden: number[], cell: number[]): number[] {
    const { hiddenSize } = this.config;
    const Wox = this.weights.Wox;
    const Woh = this.weights.Woh;
    const Woc = this.weights.Woc;
    const bo = this.weights.bo;

    const result = createVector(hiddenSize);
    
    // W_ox * x_t
    const ox = vectorMatrixMultiply(input, Wox);
    // W_oh * h_{t-1}
    const oh = vectorMatrixMultiply(prevHidden, Woh);
    // W_oc * c_t
    const oc = vectorMatrixMultiply(cell, Woc);

    for (let i = 0; i < hiddenSize; i++) {
      result[i] = ox[i] + oh[i] + oc[i] + bo[i];
    }

    return result;
  }

  private computeOutput(hidden: number[]): number[] {
    const { outputSize } = this.config;
    const Why = this.weights.Why;
    const by = this.weights.by;

    const result = vectorMatrixMultiply(hidden, Why);
    
    for (let i = 0; i < outputSize; i++) {
      result[i] += by[i];
    }

    return result;
  }

  public getHiddenState(): number[] {
    return [...this.tempHidden];
  }

  public getCellState(): number[] {
    return [...this.tempCell];
  }

  public exportWeights(): LSTMWeights {
    return JSON.parse(JSON.stringify(this.weights));
  }

  public importWeights(weights: LSTMWeights): void {
    this.weights = weights;
  }
}

// ============== LSTM Network ==============

export class LSTMNetwork {
  private readonly cells: LSTMCell[];
  private readonly config: LSTMConfig;
  private readonly vocab: Map<string, number>;
  private readonly reverseVocab: Map<number, string>;

  constructor(config: LSTMConfig, vocab?: Map<string, number>) {
    this.config = config;
    this.cells = [new LSTMCell(config)];

    // Create vocabulary if not provided
    if (vocab) {
      this.vocab = vocab;
      this.reverseVocab = new Map<number, string>();
      for (const [char, idx] of vocab) {
        this.reverseVocab.set(idx, char);
      }
    } else {
      // Default vocabulary for payload generation
      this.vocab = this.createDefaultVocab();
      this.reverseVocab = new Map<number, string>();
      for (const [char, idx] of this.vocab) {
        this.reverseVocab.set(idx, char);
      }
    }
  }

  private createDefaultVocab(): Map<string, number> {
    const defaultChars =
      'abcdefghijklmnopqrstuvwxyz' +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
      '0123456789' +
      "!@#$%^&*()_+-=[]{}|;':\",./<>?\\`~ \t\n\r";
    
    const vocab = new Map<string, number>();
vocab.set('<PAD>', 0);      // Padding token
    vocab.set('<UNK>', 1);     // Unknown character token
    vocab.set('<START>', 2);    // Start token
    vocab.set('<END>', 3);    // End token
    
    for (let i = 0; i < defaultChars.length; i++) {
      vocab.set(defaultChars[i], i + 4);
    }
    
return vocab;
  }

  /**
   * Get index for unknown token
   */
  public getUnkIndex(): number {
    return this.vocab.get('<UNK>') ?? 1;
  }

  public encode(sequence: string): number[] {
    const unkIdx = this.getUnkIndex();
    const startIdx = this.vocab.get('<START>') ?? 2;
    const encoded: number[] = [startIdx];
    
    for (const char of sequence) {
      const idx = this.vocab.get(char);
      if (idx !== undefined) {
        encoded.push(idx);
      } else {
        // Map unknown characters to <UNK> token
        encoded.push(unkIdx);
      }
    }
    
    return encoded;
  }

  public decode(encoded: number[]): string {
    let result = '';
    
    for (const idx of encoded) {
      const char = this.reverseVocab.get(idx);
      // Skip special tokens in output but preserve <UNK> markers
      if (char === '<UNK>') {
        result += '\uFFFD';  // Replacement character for unknown
      } else if (char && char !== '<PAD>' && char !== '<START>' && char !== '<END>') {
        result += char;
      }
    }
    
    return result;
  }

  public predict(encodedSequence: number[], temperature = 0.8): number {
    const { hiddenSize, inputSize } = this.config;
    
    // Initialize hidden states
    let hidden = createVector(hiddenSize);
    let cell = createVector(hiddenSize);

    // Process sequence
    for (let t = 0; t < encodedSequence.length - 1; t++) {
      const inputVec = createVector(inputSize);
      const charIdx = encodedSequence[t];
      
      if (charIdx < inputSize) {
        inputVec[charIdx] = 1;
      }

      const result = this.cells[0].forward(inputVec, hidden, cell);
      hidden = result.hidden;
      cell = result.cell;
    }

    // Get prediction for next character
    const lastInput = createVector(inputSize);
    const lastCharIdx = encodedSequence[encodedSequence.length - 1];
    
    if (lastCharIdx < inputSize) {
      lastInput[lastCharIdx] = 1;
    }

    const { output } = this.cells[0].forward(lastInput, hidden, cell);

    // Apply temperature and sample
    const scaled = output.map((x) => x / temperature);
    const probs = softmax(scaled);

    // Sample from distribution
    const rand = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (rand <= cumulative) {
        return i;
      }
    }

    return probs.length - 1;
  }

  public generate(startText: string, maxLength: number, temperature = 0.8): string {
    const encoded = this.encode(startText);
    const result: number[] = [...encoded];

    for (let i = 0; i < maxLength; i++) {
      const nextIdx = this.predict(result, temperature);
      
      // Check for end token
      const endToken = this.vocab.get('<END>');
      if (endToken !== undefined && nextIdx === endToken) {
        break;
      }

      result.push(nextIdx);
    }

    return this.decode(result);
  }

public getVocabSize(): number {
    return this.vocab.size;
  }

  public getVocabulary(): Map<string, number> {
    return new Map(this.vocab);
  }

  public exportWeights(): LSTMWeights {
    return this.cells[0].exportWeights();
  }

  public importWeights(weights: LSTMWeights): void {
    this.cells[0].importWeights(weights);
  }
}

// ============== Factory Function ==============

function buildDefaultVocab(): Map<string, number> {
  const vocab = new Map<string, number>();
  vocab.set('<PAD>', 0);
  vocab.set('<START>', 1);
  vocab.set('<END>', 2);
  
  const defaultChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;\'":,./<>?\\`~ \t\n\r';
  for (let i = 0; i < defaultChars.length; i++) {
    vocab.set(defaultChars[i], i + 3);
  }
  
  return vocab;
}

export function createLSTMNetwork(
  hiddenSize = 128,
  vocab?: Map<string, number>
): LSTMNetwork {
  const defaultVocab = vocab ?? buildDefaultVocab();

  const config: LSTMConfig = {
    inputSize: defaultVocab.size,
    hiddenSize,
    outputSize: defaultVocab.size,
    seed: Date.now(),
  };

  return new LSTMNetwork(config, defaultVocab);
}
