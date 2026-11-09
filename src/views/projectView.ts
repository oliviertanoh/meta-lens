import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ConfSetting, Diagnostic, Project } from '../core/model';

type Node = { kind: 'project'; project: Project } | { kind: 'row'; item: vscode.TreeItem };

function openAt(file: string, line?: number): vscode.Command {
  const args: unknown[] = [vscode.Uri.file(file)];
  if (line) {
    const pos = new vscode.Position(line - 1, 0);
    args.push({ selection: new vscode.Range(pos, pos) } satisfies vscode.TextDocumentShowOptions);
  }
  return { command: 'vscode.open', title: 'Open', arguments: args };
}

function fileLink(file: string, line?: number): string {
  const uri = vscode.Uri.file(file).with({ fragment: line ? `L${line}` : '' });
  const label = `${vscode.workspace.asRelativePath(file)}${line ? `:${line}` : ''}`;
  return `[${label}](${uri.toString()})`;
}

function row(
  label: string,
  description: string,
  icon: vscode.ThemeIcon,
  extra: Partial<vscode.TreeItem> = {},
): Node {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = description;
  item.iconPath = icon;
  Object.assign(item, extra);
  return { kind: 'row', item };
}

const warningIcon = (id = 'warning') =>
  new vscode.ThemeIcon(id, new vscode.ThemeColor('list.warningForeground'));

function settingRow(label: string, icon: string, s: ConfSetting | undefined, kind: string): Node {
  if (!s) {
    return row(label, '—', new vscode.ThemeIcon(icon), {
      tooltip: `${label} is not set in the configuration files meta-lens reads.`,
    });
  }
  const missing = !s.definition && !s.value.includes('${');
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${label}** = \`${s.value}\`\n\n`);
  md.appendMarkdown(`Set in ${fileLink(s.file, s.line)}  \n`);
  md.appendMarkdown(
    s.definition
      ? `Defined in ${fileLink(s.definition)}`
      : `$(warning) No \`conf/${kind}/${s.value}.conf\` in the loaded layers`,
  );
  md.supportThemeIcons = true;
  return row(label, s.value, missing ? warningIcon() : new vscode.ThemeIcon(icon), {
    tooltip: md,
    // Prefer the machine/distro definition; fall back to where it is set.
    command: s.definition ? openAt(s.definition) : openAt(s.file, s.line),
    contextValue: 'setting',
  });
}

function diagnosticRow(d: Diagnostic): Node {
  const icon =
    d.severity === 'info'
      ? new vscode.ThemeIcon('info')
      : d.severity === 'error'
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'))
        : warningIcon();
  return row(d.message, '', icon, {
    tooltip: d.message,
    command: d.file ? openAt(d.file, d.line) : undefined,
  });
}

export function projectRows(p: Project): Node[] {
  const rows: Node[] = [];

  const src = p.source;
  rows.push(
    src.file
      ? row('Config', vscode.workspace.asRelativePath(src.file), new vscode.ThemeIcon('gear'), {
          tooltip: `${src.kind === 'kas' ? 'kas file' : 'bblayers.conf'}: ${src.file}`,
          command: openAt(src.file),
        })
      : row('Config', 'workspace scan', new vscode.ThemeIcon('gear'), {
          tooltip:
            'No bblayers.conf or kas file found: layers were inferred from a workspace scan.',
        }),
  );

  const rel = p.config.release;
  rows.push(
    rel
      ? row('Release', rel.label, new vscode.ThemeIcon('tag'), {
          tooltip: `From LAYERSERIES_COMPAT_core in ${path.basename(rel.layer)}`,
          command: openAt(path.join(rel.layer, 'conf', 'layer.conf')),
        })
      : row('Release', 'unknown', new vscode.ThemeIcon('tag'), {
          tooltip: 'No layer provides the "core" collection (openembedded-core / poky meta).',
        }),
  );

  rows.push(settingRow('MACHINE', 'circuit-board', p.config.machine, 'machine'));
  rows.push(settingRow('DISTRO', 'package', p.config.distro, 'distro'));
  rows.push(
    row(
      'Mode',
      'Static scan · no bitbake env',
      new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed')),
      { tooltip: 'meta-lens reads files only: no sourced environment, no bitbake run.' },
    ),
  );

  rows.push(...p.diagnostics.map(diagnosticRow));
  return rows;
}

export class ProjectViewProvider implements vscode.TreeDataProvider<Node> {
  private projects: readonly Project[] = [];
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  setProjects(projects: readonly Project[]): void {
    this.projects = projects;
    this.emitter.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const withLayers = this.projects.filter((p) => p.layers.length > 0);
      if (withLayers.length === 1) return projectRows(withLayers[0] as Project);
      return withLayers.map((project) => ({ kind: 'project', project }));
    }
    return node.kind === 'project' ? projectRows(node.project) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'row') return node.item;
    const item = new vscode.TreeItem(
      path.basename(node.project.root),
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.iconPath = new vscode.ThemeIcon('root-folder');
    item.description = node.project.config.release?.names.join(' / ');
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
