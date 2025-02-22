export interface UIOptions {
    debug?: boolean;
    readOnly?: boolean;
}
export declare class UI {
    private screen;
    private chatBox;
    private inputBox;
    private loadingText;
    private formatter;
    private exitHandler;
    private options;
    constructor(options?: UIOptions);
    private formatMessage;
    private wordWrap;
    addMessage(role: string, content: string | any, isAppend?: boolean): void;
    showLoading(): void;
    hideLoading(): void;
    clearInput(): void;
    getInput(): string;
    onExit(callback: () => void): void;
    onSubmit(callback: (text: string) => void): void;
    private handleResize;
    destroy(): void;
}
