#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: vision-ocr <image>\n");
      return 2;
    }
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
    CGRect rect = CGRectMake(0, 0, image.size.width, image.size.height);
    CGImageRef cgImage = [image CGImageForProposedRect:&rect context:nil hints:nil];
    if (!cgImage) {
      fprintf(stderr, "cannot decode image\n");
      return 3;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelFast;
    request.usesLanguageCorrection = NO;
    NSError *error = nil;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    if (![handler performRequests:@[request] error:&error]) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 4;
    }

    NSMutableArray *results = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (!candidate) continue;
      [results addObject:@{ @"text": candidate.string, @"confidence": @(candidate.confidence) }];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:results options:0 error:&error];
    if (!data) return 5;
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
