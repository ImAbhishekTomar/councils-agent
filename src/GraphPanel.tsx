import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import * as d3 from 'd3';

type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  color: string;
  confidence: number;
  uuid: string;
  gender: string;
  fullName: string | null;
  userRole: string | null;
  summary: string;
  labels: string[];
  createdAt: string;
};

type AgentNodeData = {
  agent: Agent;
  active: boolean;
  isHub?: boolean;
};

type GraphNode = {
  id: string;
  label: string;
  subtitle: string;
  color: string;
  active: boolean;
  raw: Agent;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

type GraphLink = {
  id: string;
  source: string;
  target: string;
  name: string;
  curvature: number;
  pairTotal: number;
  raw: {
    source: string;
    target: string;
  };
};

type AppEdge = {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  type?: string;
  style?: CSSProperties;
};

type GraphPanelProps = {
  nodes: { id: string; data: AgentNodeData; position?: { x: number; y: number }; draggable?: boolean }[];
  edges: AppEdge[];
  activeAgentId?: string;
  onSelectAgent: (id?: string) => void;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
};

function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function renderNodeValue(value: string | null) {
  if (value === null || value === '') {
    return <span className="node-value-null">null</span>;
  }
  return value;
}

function nodeRadius() {
  return 10;
}

function truncateNodeLabel(label: string) {
  return label.length > 8 ? `${label.slice(0, 8)}...` : label;
}

function GraphPanel({ nodes, edges, activeAgentId, onSelectAgent, showEdgeLabels, onToggleEdgeLabels }: GraphPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const graphNodes = useMemo<GraphNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        label: node.data.agent.name,
        subtitle: node.data.agent.role,
        color: node.data.agent.color,
        active: node.data.active,
        raw: node.data.agent,
        x: node.position?.x,
        y: node.position?.y,
      })),
    [nodes],
  );

  const graphLinks = useMemo<GraphLink[]>(() => {
    const counts = new Map<string, number>();
    edges.forEach((edge) => {
      const key = [edge.source, edge.target].sort().join('_');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    const current = new Map<string, number>();
    return edges.map((edge) => {
      const key = [edge.source, edge.target].sort().join('_');
      const total = counts.get(key) ?? 1;
      const index = current.get(key) ?? 0;
      current.set(key, index + 1);
      const isReversed = edge.source > edge.target;
      let curvature = 0;
      if (total > 1) {
        const range = Math.min(1.2, 0.6 + total * 0.15);
        curvature = ((index / (total - 1)) - 0.5) * range * 2;
        if (isReversed) curvature = -curvature;
      }
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        name: 'speaks to',
        curvature,
        pairTotal: total,
        raw: { source: edge.source, target: edge.target },
      };
    });
  }, [edges]);

  const entityTypes = useMemo(
    () => {
      const map = new Map<string, string>();
      nodes.forEach((node) => {
        const type = node.data.agent.role || 'Agent';
        if (!map.has(type)) map.set(type, node.data.agent.color);
      });
      return Array.from(map.entries()).map(([name, color]) => ({ name, color }));
    },
    [nodes],
  );
  const selectedAgent = useMemo(() => nodes.find((node) => node.id === activeAgentId)?.data.agent, [activeAgentId, nodes]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width !== sizeRef.current.width || rect.height !== sizeRef.current.height) {
        sizeRef.current = { width: rect.width, height: rect.height };
        renderGraph();
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes.length, graphLinks.length, showEdgeLabels, activeAgentId]);

  useEffect(() => {
    renderGraph();
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphLinks, showEdgeLabels, activeAgentId]);

  function getLinkPath(link: GraphLink) {
    const { source, target, curvature } = link as GraphLink & { source: GraphNode; target: GraphNode };
    const sourceNode = source as unknown as GraphNode;
    const targetNode = target as unknown as GraphNode;
    const sourceX = sourceNode.x ?? 0;
    const sourceY = sourceNode.y ?? 0;
    const targetX = targetNode.x ?? 0;
    const targetY = targetNode.y ?? 0;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const sx = sourceX;
    const sy = sourceY;
    const tx = targetX;
    const ty = targetY;

    if (curvature === 0) {
      return `M${sx},${sy} L${tx},${ty}`;
    }

    const offsetRatio = 0.25 + link.pairTotal * 0.05;
    const baseOffset = Math.max(35, dist * offsetRatio);
    const offsetX = (-dy / dist) * curvature * baseOffset;
    const offsetY = (dx / dist) * curvature * baseOffset;
    const cx = (sx + tx) / 2 + offsetX;
    const cy = (sy + ty) / 2 + offsetY;
    return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
  }

  function renderGraph() {
    if (!svgRef.current || !containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    if (width === 0 || height === 0) return;

    sizeRef.current = { width, height };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.15, 4]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoom as any);

    const nodeMap = new Map<string, GraphNode>();
    graphNodes.forEach((node) => {
      if (typeof node.x !== 'number') {
        node.x = width / 2 + (Math.random() - 0.5) * 120;
      }
      if (typeof node.y !== 'number') {
        node.y = height / 2 + (Math.random() - 0.5) * 120;
      }
      nodeMap.set(node.id, node);
    });

    // d3.forceLink mutates link.source/target from string ids into node object
    // references. graphLinks is memoized and shared across renders, so we must
    // filter on the untouched `raw` ids and hand forceLink fresh copies -
    // otherwise on the next render nodeMap.has(link.source) sees an object, not
    // an id, drops every edge, and no connections render.
    const edges = graphLinks
      .filter((link) => nodeMap.has(link.raw.source) && nodeMap.has(link.raw.target))
      .map((link) => ({ ...link, source: link.raw.source, target: link.raw.target }));

    // When an agent is selected, highlight its edges + direct neighbours and dim
    // everything else. Sets are computed from the untouched `raw` ids so they stay
    // valid after d3.forceLink mutates link.source/target into node objects.
    const hasSelection = Boolean(activeAgentId);
    const neighbourIds = new Set<string>();
    const highlightedEdgeIds = new Set<string>();
    if (activeAgentId) {
      neighbourIds.add(activeAgentId);
      edges.forEach((edge) => {
        if (edge.raw.source === activeAgentId) {
          neighbourIds.add(edge.raw.target);
          highlightedEdgeIds.add(edge.id);
        } else if (edge.raw.target === activeAgentId) {
          neighbourIds.add(edge.raw.source);
          highlightedEdgeIds.add(edge.id);
        }
      });
    }
    const isEdgeHighlighted = (link: GraphLink) => highlightedEdgeIds.has(link.id);
    const labelDisplay = () => (showEdgeLabels ? 'block' : 'none');

    if (nodes.length === 0) {
      svg
        .append('text')
        .attr('class', 'graph-empty')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('alignment-baseline', 'middle')
        .text('Run the swarm to build the agent graph');
      return;
    }

    const simulation = d3
      .forceSimulation(graphNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(edges).id((d) => d.id).distance((d) => 150 + (d.pairTotal - 1) * 50).strength(1))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(50))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04));

    if (simulationRef.current) {
      simulationRef.current.stop();
    }
    simulationRef.current = simulation;

    const linkGroup = g.append('g').attr('class', 'links');

    const linkPath = linkGroup
      .selectAll<SVGPathElement, GraphLink>('path')
      .data(edges)
      .enter()
      .append('path')
      .attr('class', (d) => `link-path${hasSelection && isEdgeHighlighted(d) ? ' is-highlighted' : ''}${hasSelection && !isEdgeHighlighted(d) ? ' is-dimmed' : ''}`)
      .attr('stroke-width', (d) => (hasSelection && isEdgeHighlighted(d) ? 2.5 : 1.5))
      .attr('fill', 'none')
      .attr('stroke', (d) => (hasSelection && isEdgeHighlighted(d) ? '#E91E63' : '#C0C0C0'))
      .attr('stroke-opacity', 1)
      .attr('stroke-linecap', 'round')
      .style('cursor', 'pointer')
      .on('click', (event) => {
        event.stopPropagation();
        onSelectAgent(undefined);
      });

    const linkLabelBg = linkGroup
      .selectAll<SVGRectElement, GraphLink>('rect')
      .data(edges)
      .enter()
      .append('rect')
      .attr('class', 'link-label-bg')
      .attr('rx', 4)
      .attr('ry', 4)
      .style('display', labelDisplay());

    const linkLabelText = linkGroup
      .selectAll<SVGTextElement, GraphLink>('text')
      .data(edges)
      .enter()
      .append('text')
      .attr('class', 'link-label')
      .text((d) => d.name)
      .attr('font-size', 9)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .style('font-family', 'system-ui, sans-serif')
      .style('display', labelDisplay());

    const nodeGroup = g.append('g').attr('class', 'nodes');
    const node = nodeGroup
      .selectAll<SVGGElement, GraphNode>('g')
      .data(graphNodes)
      .enter()
      .append('g')
      .attr('class', (d) => `graph-node${d.id === activeAgentId ? ' is-selected' : ''}${hasSelection && !neighbourIds.has(d.id) ? ' is-dimmed' : ''}`)
      .attr('cursor', 'pointer')
      .on('mouseenter', (event) => {
        d3.select(event.currentTarget).classed('is-hovered', true);
      })
      .on('mouseleave', (event) => {
        d3.select(event.currentTarget).classed('is-hovered', false);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        onSelectAgent(d.id);
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    node
      .append('circle')
      .attr('class', 'graph-node-dot')
      .attr('r', nodeRadius())
      .attr('fill', (d) => d.color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', (d) => (d.id === activeAgentId ? 4 : 2.5));

    const nodeLabels = nodeGroup
      .selectAll<SVGTextElement, GraphNode>('text')
      .data(graphNodes)
      .enter()
      .append('text')
      .attr('class', 'graph-node-label')
      .text((d) => truncateNodeLabel(d.label))
      .attr('dx', 14)
      .attr('dy', 4);

    simulation.on('tick', () => {
      linkPath.attr('d', getLinkPath as any);
      linkLabelText.each(function (d) {
        const path = (d as any) as GraphLink & { source: GraphNode; target: GraphNode };
        const mid = getLinkMidpoint(path);
        d3.select(this).attr('x', mid.x).attr('y', mid.y);
      });
      linkLabelBg.each(function (d) {
        const path = (d as any) as GraphLink & { source: GraphNode; target: GraphNode };
        const mid = getLinkMidpoint(path);
        const textEl = d3.select(linkLabelText.nodes()[edges.indexOf(d)]).node();
        if (!textEl) return;
        const bbox = textEl.getBBox();
        d3.select(this)
          .attr('x', mid.x - bbox.width / 2 - 6)
          .attr('y', mid.y - bbox.height / 2 - 2)
          .attr('width', bbox.width + 12)
          .attr('height', bbox.height + 6);
      });

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      nodeLabels.attr('x', (d) => d.x ?? 0).attr('y', (d) => d.y ?? 0);
    });

    svg.on('click', () => {
      onSelectAgent(undefined);
    });
  }

  function getLinkMidpoint(link: GraphLink & { source: GraphNode; target: GraphNode }) {
    const sx = link.source.x ?? 0;
    const sy = link.source.y ?? 0;
    const tx = link.target.x ?? 0;
    const ty = link.target.y ?? 0;

    if (link.curvature === 0) {
      return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
    }

    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const offsetRatio = 0.25 + link.pairTotal * 0.05;
    const baseOffset = Math.max(35, dist * offsetRatio);
    const offsetX = (-dy / dist) * link.curvature * baseOffset;
    const offsetY = (dx / dist) * link.curvature * baseOffset;
    const cx = (sx + tx) / 2 + offsetX;
    const cy = (sy + ty) / 2 + offsetY;

    const midX = 0.25 * sx + 0.5 * cx + 0.25 * tx;
    const midY = 0.25 * sy + 0.5 * cy + 0.25 * ty;
    return { x: midX, y: midY };
  }

  return (
    <div className="graph-container" ref={containerRef}>
      <div className="edge-labels-toggle">
        <label className="toggle-switch">
          <input type="checkbox" checked={showEdgeLabels} onChange={onToggleEdgeLabels} />
          <span className="slider" />
        </label>
        <span className="toggle-label">Show edge labels</span>
      </div>
      <svg ref={svgRef} className="graph-svg" />
      {selectedAgent && (
        <aside className="node-details" style={{ '--agent-color': selectedAgent.color } as CSSProperties} onClick={(event) => event.stopPropagation()}>
          <div className="node-details-titlebar">
            <strong>Node Details</strong>
            <div className="node-details-titlebar-right">
              <span className="node-type-pill">{selectedAgent.labels[selectedAgent.labels.length - 1] ?? 'Person'}</span>
              <button type="button" className="node-details-close" onClick={() => onSelectAgent(undefined)} title="Close node details">
                ×
              </button>
            </div>
          </div>

          <div className="node-details-body">
            <dl className="node-field-grid">
              <dt>Name:</dt>
              <dd className="node-field-name">{selectedAgent.name}</dd>
              <dt>UUID:</dt>
              <dd className="node-field-uuid">{selectedAgent.uuid}</dd>
              <dt>Created:</dt>
              <dd>{formatCreated(selectedAgent.createdAt)}</dd>
            </dl>

            <hr className="node-divider" />

            <div className="node-section-title">Properties:</div>
            <dl className="node-field-grid">
              <dt>Role:</dt>
              <dd>{selectedAgent.role}</dd>
              {selectedAgent.fullName && (
                <>
                  <dt>Full name:</dt>
                  <dd>{selectedAgent.fullName}</dd>
                </>
              )}
              {selectedAgent.userRole && (
                <>
                  <dt>User role:</dt>
                  <dd>{selectedAgent.userRole}</dd>
                </>
              )}
              <dt>Gender:</dt>
              <dd>{renderNodeValue(selectedAgent.gender)}</dd>
            </dl>

            <hr className="node-divider" />

            <div className="node-section-title">Summary:</div>
            <p className="node-summary">{selectedAgent.summary}</p>

            <hr className="node-divider" />

            <div className="node-section-title">Labels:</div>
            <div className="node-label-chips">
              {selectedAgent.labels.map((label) => (
                <span className="node-label-chip" key={label}>{label}</span>
              ))}
            </div>
          </div>
        </aside>
      )}
      {entityTypes.length > 0 && (
        <div className="graph-legend">
          <span className="legend-title">Agent types</span>
          <div className="legend-items">
            {entityTypes.map((type) => (
              <div className="legend-item" key={type.name}>
                <span className="legend-dot" style={{ background: type.color }} />
                <span className="legend-label">{type.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GraphPanel;
