import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircleIcon, CheckCircleIcon, InfoIcon } from 'lucide-react';

// Define the report data structure
export interface Finding {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  code?: string;
}

export interface StateChange {
  contract: string;
  property: string;
  oldValue: string;
  newValue: string;
}

export interface Report {
  status: 'success' | 'warning' | 'error';
  summary: string;
  gasUsed: string;
  findings: Finding[];
  stateChanges: StateChange[];
  logs: string[];
}

// Helper components
function StatusIndicator({ status }: { status: Report['status'] }) {
  const colors = {
    success: 'text-green-500',
    warning: 'text-yellow-500',
    error: 'text-red-500',
  };

  const icons = {
    success: <CheckCircleIcon className="h-5 w-5" />,
    warning: <AlertCircleIcon className="h-5 w-5" />,
    error: <AlertCircleIcon className="h-5 w-5" />,
  };

  return (
    <div className={`flex items-center gap-2 ${colors[status]}`}>
      {icons[status]}
      <span className="font-medium">
        {status === 'success' ? 'Passed' : status === 'warning' ? 'Warnings' : 'Failed'}
      </span>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-background p-3 rounded-md border">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-lg font-medium">{value}</p>
    </div>
  );
}

function FindingItem({ finding }: { finding: Finding }) {
  const severityColors = {
    critical: 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/50',
    warning: 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900/50',
    info: 'border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900/50',
  };

  const severityTextColors = {
    critical: 'text-red-800 dark:text-red-300',
    warning: 'text-yellow-800 dark:text-yellow-300',
    info: 'text-blue-800 dark:text-blue-300',
  };

  return (
    <div className={`p-3 rounded-md border ${severityColors[finding.severity]}`}>
      <div className="flex justify-between items-start">
        <h4 className={`font-medium ${severityTextColors[finding.severity]}`}>{finding.title}</h4>
        <Badge
          variant={
            finding.severity === 'critical'
              ? 'destructive'
              : finding.severity === 'warning'
                ? 'default'
                : 'secondary'
          }
        >
          {finding.severity}
        </Badge>
      </div>
      <p className="mt-2 text-sm">{finding.description}</p>
      {finding.code && (
        <pre className="mt-2 bg-muted p-2 rounded text-xs overflow-auto">{finding.code}</pre>
      )}
    </div>
  );
}

// Main ReportCard component
export function ReportCard({ report }: { report?: Report }) {
  if (!report) {
    return (
      <Card className="w-full h-full">
        <CardHeader>
          <CardTitle>Simulation Report</CardTitle>
          <CardDescription>Analysis and findings from the simulation</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No report data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full h-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Simulation Report</CardTitle>
            <CardDescription>Analysis and findings from the simulation</CardDescription>
          </div>
          <StatusIndicator status={report.status} />
        </div>
      </CardHeader>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="findings">Findings ({report.findings.length})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <CardContent>
            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-md">
                <p>{report.summary}</p>
              </div>

              <div>
                <h3 className="font-medium text-sm mb-2">Key Metrics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <MetricCard title="Gas Used" value={report.gasUsed} />
                  <MetricCard title="State Changes" value={report.stateChanges.length} />
                </div>
              </div>
            </div>
          </CardContent>
        </TabsContent>

        <TabsContent value="findings">
          <CardContent>
            <div className="space-y-4">
              {report.findings.length === 0 ? (
                <div className="flex items-center justify-center p-6 text-muted-foreground">
                  <InfoIcon className="h-4 w-4 mr-2" />
                  <span>No findings detected</span>
                </div>
              ) : (
                report.findings.map((finding) => <FindingItem key={finding.id} finding={finding} />)
              )}
            </div>
          </CardContent>
        </TabsContent>

        <TabsContent value="details">
          <CardContent>
            <div className="space-y-4">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="state-changes">
                  <AccordionTrigger>State Changes ({report.stateChanges.length})</AccordionTrigger>
                  <AccordionContent>
                    {report.stateChanges.length === 0 ? (
                      <p className="text-muted-foreground">No state changes detected</p>
                    ) : (
                      <div className="space-y-2">
                        {report.stateChanges.map((change, index) => (
                          <div
                            key={`${change.contract}-${change.property}-${index}`}
                            className="bg-muted p-3 rounded-md text-sm"
                          >
                            <div className="font-medium">{change.contract}</div>
                            <div className="mt-1">
                              <span className="text-muted-foreground">Property: </span>
                              {change.property}
                            </div>
                            <div className="mt-1 grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-muted-foreground">Old: </span>
                                <span className="font-mono">{change.oldValue}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">New: </span>
                                <span className="font-mono">{change.newValue}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="logs">
                  <AccordionTrigger>Logs ({report.logs.length})</AccordionTrigger>
                  <AccordionContent>
                    {report.logs.length === 0 ? (
                      <p className="text-muted-foreground">No logs available</p>
                    ) : (
                      <pre className="bg-muted p-3 rounded-md overflow-auto text-xs font-mono">
                        {report.logs.join('\n')}
                      </pre>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </CardContent>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
