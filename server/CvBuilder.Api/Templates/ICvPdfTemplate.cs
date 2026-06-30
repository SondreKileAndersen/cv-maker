using CvBuilder.Api.Models;

namespace CvBuilder.Api.Templates;

public interface ICvPdfTemplate
{
    string Id { get; }
    string Name { get; }
    string Description { get; }
    byte[] Render(CvDocument document);
}
