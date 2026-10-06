import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCaseAssistantMessages, getLead, getMessages } from "@/lib/db";
import { AnamnesisPanel } from "@/components/leads/patient-card/anamnesis-panel";
import { CaseAssistantPanel } from "@/components/leads/patient-card/case-assistant-panel";
import { ChatPanel } from "@/components/leads/patient-card/chat-panel";
import { NotesPanel } from "@/components/leads/patient-card/notes-panel";
import { StagePanel } from "@/components/leads/patient-card/stage-panel";
import { TagsPanel } from "@/components/leads/patient-card/tags-panel";
import { PhoneLink } from "@/components/leads/phone-link";
import { WaitingBadge } from "@/components/leads/waiting-badge";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();
  const messages = await getMessages(params.id);
  const caseAssistantMessages = await getCaseAssistantMessages(params.id);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-5">
      <Link
        href="/dashboard/leads"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку лидов
      </Link>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">{lead.name}</h1>
              <WaitingBadge lead={lead} />
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm text-muted-foreground">{lead.phone}</p>
              <PhoneLink phone={lead.phone} className="h-6 w-6 text-primary hover:bg-primary/10 hover:text-primary" />
            </div>
          </div>
          <AnamnesisPanel lead={lead} />
          <ChatPanel
            leadId={lead.id}
            initialMessages={messages}
            initialAiPaused={lead.aiPaused}
          />
        </div>
        <div className="flex flex-col gap-4">
          <StagePanel lead={lead} />
          <TagsPanel leadId={lead.id} initialTags={lead.tags} />
          <NotesPanel leadId={lead.id} initialNotes={lead.notes} />
          <CaseAssistantPanel leadId={lead.id} initialMessages={caseAssistantMessages} />
        </div>
      </div>
    </div>
  );
}
