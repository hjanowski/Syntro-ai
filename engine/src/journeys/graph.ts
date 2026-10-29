import type { BranchCondition, IntendedStep, JourneyDefinition, JourneyEdge, JourneyNode, SyntheticCustomer } from '../domain/types.ts';
import { Rng } from '../util/rng.ts';
import { NODE_CATALOG, describeNode } from './node-catalog.ts';

export function getStartNode(journey: JourneyDefinition): JourneyNode | undefined {
  return journey.nodes.find((n) => n.type === 'start');
}

export function outgoing(journey: JourneyDefinition, nodeId: string): JourneyEdge[] {
  return journey.edges.filter((e) => e.source === nodeId);
}

export function nodeLabel(node: JourneyNode): string {
  return node.label?.trim() || describeNode(node.type, node.config ?? {});
}

export function evaluateCondition(condition: BranchCondition | undefined, customer: SyntheticCustomer, rng: Rng): boolean {
  if (!condition) return true;
  switch (condition.kind) {
    case 'customer_index_in':
      return condition.values.includes(customer.index);
    case 'customer_index_mod':
      return customer.index % condition.mod === condition.equals;
    case 'attribute_equals':
      return customer.attributes[condition.key] === condition.value;
    case 'probability':
      return rng.chance(condition.p);
    default:
      return true;
  }
}

/** Resolve the next node id from `node` for this customer (branches are evaluated deterministically). */
export function nextNodeId(journey: JourneyDefinition, node: JourneyNode, customer: SyntheticCustomer, rng: Rng): string | null {
  const edges = outgoing(journey, node.id);
  if (edges.length === 0) return null;
  if (node.type === 'branch') {
    const outcome = evaluateCondition(node.config.condition as BranchCondition | undefined, customer, rng) ? 'yes' : 'no';
    const edge = edges.find((e) => (e.condition ?? 'yes') === outcome) ?? edges.find((e) => !e.condition);
    return edge?.target ?? null;
  }
  return edges[0].target;
}

/** Walk the graph for a customer and return the sequence of steps that will be executed. */
export function linearize(journey: JourneyDefinition, customer: SyntheticCustomer, seed = 1, maxSteps = 200): IntendedStep[] {
  const rng = new Rng(`${seed}:${customer.id}:plan`);
  const byId = new Map(journey.nodes.map((n) => [n.id, n]));
  const steps: IntendedStep[] = [];
  let current = getStartNode(journey);
  let guard = 0;
  while (current && guard++ < maxSteps) {
    steps.push({ nodeId: current.id, type: current.type, label: nodeLabel(current) });
    if (current.type === 'end') break;
    const next = nextNodeId(journey, current, customer, rng);
    if (!next) break;
    current = byId.get(next);
  }
  return steps;
}

export interface GraphValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateJourney(journey: Pick<JourneyDefinition, 'nodes' | 'edges'>): GraphValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const starts = journey.nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) errors.push(`Journey must have exactly one Start node (found ${starts.length}).`);
  for (const node of journey.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id ${node.id}.`);
    ids.add(node.id);
    if (!NODE_CATALOG[node.type]) errors.push(`Unknown node type ${node.type}.`);
  }
  for (const edge of journey.edges) {
    if (!ids.has(edge.source)) errors.push(`Edge ${edge.id} source ${edge.source} does not exist.`);
    if (!ids.has(edge.target)) errors.push(`Edge ${edge.id} target ${edge.target} does not exist.`);
  }
  for (const node of journey.nodes) {
    const out = journey.edges.filter((e) => e.source === node.id);
    if (node.type === 'branch') {
      const yes = out.some((e) => (e.condition ?? 'yes') === 'yes');
      const no = out.some((e) => e.condition === 'no');
      if (!yes || !no) warnings.push(`Branch ${node.id} should have both a "yes" and a "no" edge.`);
    } else if (node.type !== 'end' && out.length === 0) {
      warnings.push(`Node "${nodeLabel(node)}" has no outgoing edge; the journey ends there.`);
    } else if (node.type !== 'end' && out.length > 1) {
      warnings.push(`Node "${nodeLabel(node)}" has ${out.length} outgoing edges; only the first is followed.`);
    }
  }
  const reachable = new Set<string>();
  const start = starts[0];
  if (start) {
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of journey.edges) if (e.source === id) queue.push(e.target);
    }
    for (const node of journey.nodes) if (!reachable.has(node.id)) warnings.push(`Node "${nodeLabel(node)}" is not reachable from Start.`);
  }
  const hasConversion = journey.nodes.some((n) => ['checkout', 'fill_form', 'register', 'conversion_event'].includes(n.type));
  if (!hasConversion) warnings.push('Journey has no conversion step; attribution tests will be skipped.');
  return { valid: errors.length === 0, errors, warnings };
}
