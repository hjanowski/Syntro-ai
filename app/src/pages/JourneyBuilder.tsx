import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { NODE_CATALOG, NODE_CATEGORY, NODE_TYPES, describeNode, type JourneyDefinition, type JourneyEdge, type JourneyNode, type JourneyValidationResult, type NodeType } from '@syntro/engine';
import { ArrowLeft, Check, Cookie, Flag, Globe, Megaphone, Play, Save, Shuffle, Smartphone, Timer, Trash2, Workflow, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { Badge, Button, ErrorBanner, Field, InfoBanner, Input, Loading, Select, Toggle, cn } from '@/components/ui.tsx';

type SyntroNodeData = { nodeType: NodeType; config: Record<string, unknown>; label?: string };
type SyntroNode = Node<SyntroNodeData, 'syntro'>;

const CATEGORY_STYLE: Record<string, { bg: string; ring: string; text: string; icon: typeof Globe }> = {
  marketing: { bg: 'bg-brand-600', ring: 'ring-brand-200', text: 'text-brand-700', icon: Megaphone },
  website: { bg: 'bg-slate-800', ring: 'ring-slate-200', text: 'text-slate-700', icon: Globe },
  logic: { bg: 'bg-amber-500', ring: 'ring-amber-200', text: 'text-amber-700', icon: Workflow },
};

function iconFor(type: NodeType) {
  switch (type) {
    case 'start':
      return Play;
    case 'end':
      return Flag;
    case 'branch':
      return Shuffle;
    case 'wait':
      return Timer;
    case 'change_device':
      return Smartphone;
    case 'clear_cookies':
      return Cookie;
    case 'inject_failure':
      return Zap;
    default:
      return CATEGORY_STYLE[NODE_CATEGORY[type]].icon;
  }
}

function SyntroNodeView({ data, selected }: NodeProps<SyntroNode>) {
  const spec = NODE_CATALOG[data.nodeType];
  const style = CATEGORY_STYLE[spec.category];
  const Icon = iconFor(data.nodeType);
  const isBranch = data.nodeType === 'branch';
  return (
    <div className={cn('w-56 rounded-2xl border bg-white shadow-card transition', selected ? 'border-brand-500 ring-4 ring-brand-100' : 'border-slate-200')}>
      {data.nodeType !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="flex items-start gap-3 p-3">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white', style.bg)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className={cn('text-[10px] font-semibold uppercase tracking-wider', style.text)}>{spec.label}</div>
          <div className="truncate text-sm font-semibold text-slate-900" title={data.label || describeNode(data.nodeType, data.config)}>
            {data.label || describeNode(data.nodeType, data.config)}
          </div>
        </div>
      </div>
      {isBranch ? (
        <>
          <Handle type="source" position={Position.Right} id="yes" style={{ top: '35%' }} />
          <Handle type="source" position={Position.Right} id="no" style={{ top: '70%', background: '#f59e0b' }} />
          <div className="pointer-events-none absolute -right-9 top-[26%] text-[10px] font-semibold text-emerald-600">yes</div>
          <div className="pointer-events-none absolute -right-7 top-[61%] text-[10px] font-semibold text-amber-600">no</div>
        </>
      ) : (
        data.nodeType !== 'end' && <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes = { syntro: SyntroNodeView };

function toFlow(j: JourneyDefinition): { nodes: SyntroNode[]; edges: Edge[] } {
  const branchIds = new Set(j.nodes.filter((n) => n.type === 'branch').map((n) => n.id));
  return {
    nodes: j.nodes.map((n, i) => ({ id: n.id, type: 'syntro', position: n.position ?? { x: 60 + i * 240, y: 160 }, data: { nodeType: n.type, config: { ...n.config }, label: n.label } })),
    edges: j.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: branchIds.has(e.source) ? (e.condition ?? 'yes') : undefined,
      label: e.label ?? (branchIds.has(e.source) ? (e.condition ?? 'yes') : undefined),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
    })),
  };
}

function fromFlow(nodes: SyntroNode[], edges: Edge[]): { nodes: JourneyNode[]; edges: JourneyEdge[] } {
  const branchIds = new Set(nodes.filter((n) => n.data.nodeType === 'branch').map((n) => n.id));
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, label: n.data.label, config: n.data.config, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, condition: branchIds.has(e.source) ? ((e.sourceHandle as 'yes' | 'no' | null) ?? 'yes') : undefined, label: typeof e.label === 'string' ? e.label : undefined })),
  };
}

export default function JourneyBuilder() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}

function Builder() {
  const { journeyId = '' } = useParams();
  const { client } = useEngine();
  const navigate = useNavigate();
  const { data: journey, error, loading } = useAsync(() => client.getJourney(journeyId), [client, journeyId]);
  const { data: templates } = useAsync(() => client.listJourneyTemplates(), [client]);
  const [nodes, setNodes] = useState<SyntroNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<JourneyValidationResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const flow = useReactFlow();

  useEffect(() => {
    if (!journey) return;
    const f = toFlow(journey);
    setNodes(f.nodes);
    setEdges(f.edges);
    setName(journey.name);
    setDescription(journey.description ?? '');
    setDirty(false);
    setValidation(null);
  }, [journey]);

  const onNodesChange = useCallback((changes: NodeChange<SyntroNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type !== 'select')) setDirty(true);
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    setEdges((es) => addEdge({ ...conn, id: `e_${Math.random().toString(36).slice(2, 8)}`, type: 'smoothstep', label: conn.sourceHandle ?? undefined, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } }, es));
    setDirty(true);
  }, []);

  const addNode = (type: NodeType) => {
    const spec = NODE_CATALOG[type];
    const id = `n_${Math.random().toString(36).slice(2, 8)}`;
    const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node: SyntroNode = { id, type: 'syntro', position: { x: center.x - 112 + (Math.random() * 60 - 30), y: center.y - 40 + (Math.random() * 60 - 30) }, data: { nodeType: type, config: { ...spec.defaults } } };
    setNodes((ns) => [...ns, node]);
    setSelected(id);
    setDirty(true);
  };

  const updateSelected = (patch: Partial<SyntroNodeData>) => {
    setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  };

  const deleteSelected = () => {
    if (selected) {
      setNodes((ns) => ns.filter((n) => n.id !== selected));
      setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
      setSelected(null);
      setDirty(true);
    }
    if (selectedEdge) {
      setEdges((es) => es.filter((e) => e.id !== selectedEdge));
      setSelectedEdge(null);
      setDirty(true);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const def = fromFlow(nodes, edges);
      await client.updateJourney(journeyId, { name, description, ...def });
      setDirty(false);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    const def = fromFlow(nodes, edges);
    setValidation(await client.validateJourney(def));
  };

  const runJourney = async () => {
    if (!journey) return;
    if (dirty) await save();
    const projectId = journey.projectId;
    if (!projectId) return;
    const scenarios = await client.listScenarios(projectId);
    let scenario = scenarios.find((s) => s.journeyId === journey.id);
    if (!scenario) scenario = await client.createScenario({ projectId, name: `${name} (ad hoc)`, journeyId: journey.id, defaultCustomerCount: 2 });
    navigate(`/simulations?project=${projectId}&scenario=${scenario.id}`);
  };

  const loadTemplate = (key: string) => {
    const t = templates?.find((x) => x.key === key);
    if (!t || !confirm(`Replace the current canvas with "${t.name}"?`)) return;
    const f = toFlow({ ...t, id: journeyId, projectId: null, version: 1, isTemplate: false, createdAt: '', updatedAt: '' });
    setNodes(f.nodes);
    setEdges(f.edges);
    setName(t.name);
    setDescription(t.description);
    setDirty(true);
  };

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);
  const selectedEdgeObj = useMemo(() => edges.find((e) => e.id === selectedEdge) ?? null, [edges, selectedEdge]);
  const grouped = useMemo(() => ({ marketing: NODE_TYPES.filter((t) => NODE_CATEGORY[t] === 'marketing'), website: NODE_TYPES.filter((t) => NODE_CATEGORY[t] === 'website'), logic: NODE_TYPES.filter((t) => NODE_CATEGORY[t] === 'logic' && t !== 'start') }), []);

  if (loading && !journey) return <Loading />;
  if (!journey) return <ErrorBanner message={error ?? 'Journey not found'} />;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-0px)] flex-col sm:-mx-6 lg:-mx-8">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link to={journey.projectId ? `/projects/${journey.projectId}` : '/journeys'} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="min-w-[240px] rounded-lg border border-transparent px-2 py-1 text-base font-semibold text-slate-900 hover:border-slate-200 focus:border-brand-400 focus:outline-none" />
        {dirty ? <Badge tone="warning">Unsaved changes</Badge> : <Badge tone="success">Saved</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Select className="w-auto" value="" onChange={(e) => e.target.value && loadTemplate(e.target.value)}>
            <option value="">Load template…</option>
            {templates?.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={validate}>
            Validate
          </Button>
          <Button variant="secondary" size="sm" icon={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
          <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={runJourney}>
            Run this journey
          </Button>
        </div>
      </div>
      {saveError && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{saveError}</div>}
      {validation && (
        <div className={cn('flex flex-wrap items-start gap-4 border-b px-4 py-2 text-xs', validation.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800')}>
          <span className="inline-flex items-center gap-1 font-semibold">{validation.valid ? <Check className="h-3.5 w-3.5" /> : null}{validation.valid ? 'Journey is valid' : 'Journey has errors'}</span>
          {validation.errors.map((e, i) => <span key={i}>• {e}</span>)}
          {validation.warnings.map((w, i) => <span key={i} className="text-amber-700">⚠ {w}</span>)}
          {validation.valid && <span className="text-slate-600">Preview (customer #1): {validation.preview.map((s) => s.label).join(' → ')}</span>}
          <button className="ml-auto underline" onClick={() => setValidation(null)}>dismiss</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="scrollbar-thin w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
          <p className="mb-3 text-[11px] text-slate-500">Click a block to add it to the canvas, then connect the blocks by dragging between handles.</p>
          {(Object.keys(grouped) as Array<keyof typeof grouped>).map((cat) => (
            <div key={cat} className="mb-4">
              <div className={cn('mb-1.5 text-[10px] font-semibold uppercase tracking-wider', CATEGORY_STYLE[cat].text)}>{cat === 'marketing' ? 'Marketing interactions' : cat === 'website' ? 'Website interactions' : 'Journey logic'}</div>
              <div className="space-y-1">
                {grouped[cat].map((t) => {
                  const Icon = iconFor(t);
                  return (
                    <button key={t} onClick={() => addNode(t)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50">
                      <span className={cn('flex h-6 w-6 items-center justify-center rounded-md text-white', CATEGORY_STYLE[cat].bg)}>
                        <Icon className="h-3 w-3" />
                      </span>
                      {NODE_CATALOG[t].label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>
        <div className="relative min-w-0 flex-1 bg-slate-50">
          <ReactFlow<SyntroNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => { setSelected(n.id); setSelectedEdge(null); }}
            onEdgeClick={(_, e) => { setSelectedEdge(e.id); setSelected(null); }}
            onPaneClick={() => { setSelected(null); setSelectedEdge(null); }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="#e2e8f0" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-white" nodeColor={(n) => (CATEGORY_STYLE[NODE_CATEGORY[(n.data as SyntroNodeData).nodeType]].bg.includes('brand') ? '#4f46e5' : CATEGORY_STYLE[NODE_CATEGORY[(n.data as SyntroNodeData).nodeType]].bg.includes('amber') ? '#f59e0b' : '#1e293b')} />
          </ReactFlow>
        </div>
        <aside className="scrollbar-thin w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {selectedNode ? (
            <NodeConfigPanel node={selectedNode} onChange={updateSelected} onDelete={deleteSelected} />
          ) : selectedEdgeObj ? (
            <EdgePanel edge={selectedEdgeObj} isBranch={nodes.find((n) => n.id === selectedEdgeObj.source)?.data.nodeType === 'branch'} onChange={(patch) => { setEdges((es) => es.map((e) => (e.id === selectedEdgeObj.id ? { ...e, ...patch } : e))); setDirty(true); }} onDelete={deleteSelected} />
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Journey</div>
                <p className="text-xs text-slate-500">Select a block to configure its touchpoint parameters and behaviour.</p>
              </div>
              <Field label="Description">
                <textarea className="h-24 w-full rounded-xl border border-slate-200 p-2 text-sm" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} />
              </Field>
              <InfoBanner>
                {nodes.length} blocks · {edges.length} connections. Conversions ({nodes.filter((n) => ['checkout', 'fill_form', 'register', 'conversion_event'].includes(n.data.nodeType)).length}) define what attribution is expected to credit.
              </InfoBanner>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeConfigPanel({ node, onChange, onDelete }: { node: SyntroNode; onChange: (patch: Partial<SyntroNodeData>) => void; onDelete: () => void }) {
  const spec = NODE_CATALOG[node.data.nodeType];
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const setConfig = (key: string, value: unknown) => onChange({ config: { ...node.data.config, [key]: value } });
  return (
    <div className="space-y-4">
      <div>
        <div className={cn('text-[10px] font-semibold uppercase tracking-wider', CATEGORY_STYLE[spec.category].text)}>{spec.category}</div>
        <div className="text-sm font-semibold text-slate-900">{spec.label}</div>
        <p className="mt-1 text-xs text-slate-500">{spec.description}</p>
      </div>
      <Field label="Label" hint="optional">
        <Input value={node.data.label ?? ''} onChange={(e) => onChange({ label: e.target.value || undefined })} placeholder={describeNode(node.data.nodeType, node.data.config)} />
      </Field>
      {spec.fields.map((f) => {
        const value = node.data.config[f.key];
        if (f.type === 'select') {
          return (
            <Field key={f.key} label={f.label} hint={f.help}>
              <Select value={String(value ?? '')} onChange={(e) => setConfig(f.key, e.target.value)}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (f.type === 'boolean') return <Toggle key={f.key} checked={!!value} onChange={(v) => setConfig(f.key, v)} label={f.label} hint={f.help} />;
        if (f.type === 'number') return <Field key={f.key} label={f.label} hint={f.help}><Input type="number" value={value === undefined ? '' : String(value)} onChange={(e) => setConfig(f.key, e.target.value === '' ? undefined : Number(e.target.value))} /></Field>;
        if (f.type === 'json') {
          return (
            <Field key={f.key} label={f.label} hint={f.help}>
              <textarea
                className={cn('h-24 w-full rounded-xl border p-2 font-mono text-xs', jsonErrors[f.key] ? 'border-rose-400' : 'border-slate-200')}
                defaultValue={JSON.stringify(value ?? {}, null, 1)}
                onBlur={(e) => {
                  try {
                    setConfig(f.key, JSON.parse(e.target.value));
                    setJsonErrors((s) => ({ ...s, [f.key]: '' }));
                  } catch (err) {
                    setJsonErrors((s) => ({ ...s, [f.key]: (err as Error).message }));
                  }
                }}
              />
              {jsonErrors[f.key] && <div className="mt-1 text-xs text-rose-600">{jsonErrors[f.key]}</div>}
            </Field>
          );
        }
        return <Field key={f.key} label={f.label} hint={f.help}><Input value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => setConfig(f.key, e.target.value)} /></Field>;
      })}
      {node.data.nodeType !== 'start' && (
        <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete} className="text-rose-600">
          Remove block
        </Button>
      )}
    </div>
  );
}

function EdgePanel({ edge, isBranch, onChange, onDelete }: { edge: Edge; isBranch: boolean; onChange: (patch: Partial<Edge>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-slate-900">Connection</div>
        <p className="text-xs text-slate-500">{edge.source} → {edge.target}</p>
      </div>
      {isBranch && (
        <Field label="Branch outcome">
          <Select value={edge.sourceHandle ?? 'yes'} onChange={(e) => onChange({ sourceHandle: e.target.value, label: e.target.value })}>
            <option value="yes">yes — condition is true</option>
            <option value="no">no — condition is false</option>
          </Select>
        </Field>
      )}
      <Field label="Label" hint="optional">
        <Input value={typeof edge.label === 'string' ? edge.label : ''} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete} className="text-rose-600">
        Remove connection
      </Button>
    </div>
  );
}
