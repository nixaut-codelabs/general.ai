import type { GeneralAIParsedProtocol, GeneralAIProtocolEvent } from "./types.js";
interface ParseContext {
    step: number;
}
export declare class ProtocolStreamParser {
    #private;
    private readonly context;
    constructor(context: ParseContext);
    push(chunk: string): GeneralAIParsedProtocol;
    end(): GeneralAIParsedProtocol;
    snapshot(): GeneralAIParsedProtocol;
}
export declare function parseProtocol(text: string, context?: ParseContext): GeneralAIParsedProtocol;
export declare function validateProtocolSequence(events: GeneralAIProtocolEvent[], safetyEnabled: boolean): string[];
export {};
