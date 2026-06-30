namespace CvBuilder.Api.Templates;

public sealed class TemplateRegistry
{
    private readonly IReadOnlyList<ICvPdfTemplate> _templates =
    [
        new StandardCvTemplate()
    ];

    public IReadOnlyList<ICvPdfTemplate> GetTemplates() => _templates;

    public ICvPdfTemplate? Find(string id) =>
        _templates.FirstOrDefault(t => string.Equals(t.Id, id, StringComparison.OrdinalIgnoreCase));
}
