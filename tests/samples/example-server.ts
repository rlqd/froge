import froge from "../../src";

export default function createExampleServer(text: string) {
    return froge().up({
        exampleService: ctx => 'example ' + text,
    });
}
