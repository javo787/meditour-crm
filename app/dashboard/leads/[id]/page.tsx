import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getLead, getMessages } from "@/lib/db";
import { AnamnesisPanel } from "@/components/leads/patient-card/anamnesis-panel";
import { ChatPanel } from "@/components/leads/patient-card/chat-panel";
import { GeneratePanel } from "@/components/leads/patient-card/generate-panel";
import { NotesPanel } from "@/components/leads/patient-card/notes-panel";
import { StagePanel } from "@/components/leads/patient-card/stage-panel";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();
  const messages = await getMessages(params.id);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
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
            <h1 className="text-lg font-semibold tracking-tight">{lead.name}</h1>
            <p className="text-sm text-muted-foreground">{lead.phone}</p>
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
          <NotesPanel leadId={lead.id} initialNotes={lead.notes} />
          <GeneratePanel leadId={lead.id} />
        </div>
      </div>
    </div>
  );
}
